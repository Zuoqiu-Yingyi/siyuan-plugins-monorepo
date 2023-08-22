/**
 * Copyright (C) 2023 Zuoqiu Yingyi
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import siyuan from "siyuan";

import icon_wakatime from "./assets/symbols/icon-wakatime.symbol?raw";
import icon_wakatime_wakapi from "./assets/symbols/icon-wakatime-wakapi.symbol?raw";
import manifest from "~/public/plugin.json";

import { Client } from "@siyuan-community/siyuan-sdk";

import Settings from "./components/Settings.svelte";

import {
    FLAG_MOBILE,
} from "@workspace/utils/env/front-end";
import { Logger } from "@workspace/utils/logger";
import { mergeIgnoreArray } from "@workspace/utils/misc/merge";
import { parse } from "@workspace/utils/path/browserify";
import { normalize } from "@workspace/utils/path/normalize";
import { WorkerBridgeMaster } from "@workspace/utils/worker/bridge/master";
import CONSTANTS from "./constants";
import { DEFAULT_CONFIG } from "./configs/default";
import type { IConfig } from "./types/config";
import type { IHandlers } from "./workers/wakatime";
import type {
    Context,
} from "./types/wakatime";
import type {
    IWebSocketMainEvent,
    IClickEditorContentEvent,
    ILoadedProtyleEvent,
} from "@workspace/types/siyuan/events";
import type { ITransaction } from "@workspace/types/siyuan/transaction";

export default class WakaTimePlugin extends siyuan.Plugin {
    static readonly GLOBAL_CONFIG_NAME = "global-config";

    public readonly siyuan = siyuan;
    public readonly logger: InstanceType<typeof Logger>;
    public readonly client: InstanceType<typeof Client>;

    protected readonly SETTINGS_DIALOG_ID: string;

    public config: IConfig;
    protected bridge: InstanceType<typeof WorkerBridgeMaster>; // worker 桥

    protected heartbeatTimer: number; // 心跳定时器
    protected cacheCheckTimer: number; // 缓存检查定时器

    constructor(options: any) {
        super(options);

        this.logger = new Logger(this.name);
        this.client = new Client(undefined, "fetch");

        this.SETTINGS_DIALOG_ID = `${this.name}-settings-dialog`;
    }

    onload(): void {
        // this.logger.debug(this);

        /* 注册图标 */
        this.addIcons([
            icon_wakatime,
            icon_wakatime_wakapi,
        ].join(""));

        /* 加载配置文件 */
        this.loadData(WakaTimePlugin.GLOBAL_CONFIG_NAME)
            .then(config => {
                this.config = mergeIgnoreArray(DEFAULT_CONFIG, config || {}) as IConfig;
            })
            .catch(error => this.logger.error(error))
            .finally(async () => {
                const worker = new Worker(
                    `${globalThis.document.baseURI}plugins/${this.name}/workers/wakatime.js?v=${manifest.version}`,
                    {
                        type: "module",
                        name: this.name,
                        credentials: "same-origin",
                    },
                );
                this.bridge = new WorkerBridgeMaster(
                    worker,
                    this.logger,
                );

                await this.bridge.call<IHandlers["onload"]>("onload");
                await this.updateWorkConfig();

                /* 总线 */
                this.eventBus.on("ws-main", this.webSocketMainEventListener);

                /* 编辑器加载 */
                this.eventBus.on("loaded-protyle", this.loadedProtyleEventListener);

                /* 编辑区点击 */
                this.eventBus.on("click-editorcontent", this.clickEditorContentEventListener);
            });
    }

    onLayoutReady(): void {
    }

    onunload(): void {
        this.eventBus.off("ws-main", this.webSocketMainEventListener);
        this.eventBus.off("loaded-protyle", this.loadedProtyleEventListener);
        this.eventBus.off("click-editorcontent", this.clickEditorContentEventListener);

        this.bridge.call<IHandlers["unload"]>("unload")
            .then(() => this.bridge.terminate());
    }

    openSetting(): void {
        const that = this;
        const dialog = new siyuan.Dialog({
            title: `${this.i18n.displayName} <code class="fn__code">${this.name}</code>`,
            content: `<div id="${that.SETTINGS_DIALOG_ID}" class="fn__flex-column" />`,
            width: FLAG_MOBILE ? "92vw" : "720px",
            height: FLAG_MOBILE ? undefined : "640px",
        });
        const settings = new Settings({
            target: dialog.element.querySelector(`#${that.SETTINGS_DIALOG_ID}`),
            props: {
                config: this.config,
                plugin: this,
            },
        });
    }

    /* 重置插件配置 */
    public async resetConfig(): Promise<void> {
        return this.updateConfig(mergeIgnoreArray(DEFAULT_CONFIG) as IConfig);
    }

    /* 清理缓存 */
    public async clearCache(directory: string = CONSTANTS.OFFLINE_CACHE_PATH): Promise<boolean> {
        try {
            await this.client.removeFile({ path: directory });
            return true;
        } catch (error) {
            return false
        }
    }

    /* 更新插件配置 */
    public async updateConfig(config?: IConfig): Promise<void> {
        if (config && config !== this.config) {
            this.config = config;
        }
        await this.updateWorkConfig();
        return this.saveData(WakaTimePlugin.GLOBAL_CONFIG_NAME, this.config);
    }

    /* 更新 worker 配置 */
    public async updateWorkConfig(): Promise<void> {
        await this.bridge.call<IHandlers["updateConfig"]>(
            "updateConfig",
            this.config,
            {
                url: this.wakatimeHeartbeatsApiUrl,
                headers: this.wakatimeHeaders,
                project: this.wakatimeProject,
                language: this.wakatimeLanguage,
            },
        );
        await this.bridge.call<IHandlers["restart"]>("restart");
    }

    /* 总线事件监听器 */
    protected readonly webSocketMainEventListener = (e: IWebSocketMainEvent) => {
        // this.logger.debug(e);
        if (e.detail.cmd === "transactions") {
            const transactions = e.detail.data as ITransaction[];

            /* 获取所有更改的块 ID */
            transactions?.forEach(transaction => {
                transaction.doOperations?.forEach(operation => {
                    switch (operation.action) {
                        case "delete": // 忽略删除操作
                            return;
                        default:
                            break;
                    }

                    if (operation.id) {
                        this.bridge.call<IHandlers["addEditEvent"]>(
                            "addEditEvent",
                            operation.id,
                        );
                    }
                });
                // transaction.undoOperations?.forEach(operation => {
                //     this.addEditEvent(operation.id);
                // });
            });
        }
    }

    /* 编辑器加载事件监听器 */
    protected readonly loadedProtyleEventListener = (e: ILoadedProtyleEvent) => {
        // this.logger.debug(e);
        const protyle = e.detail;
        if (protyle.notebookId && protyle.path && protyle.block.rootID) {
            this.bridge.call<IHandlers["addViewEvent"]>(
                "addViewEvent",
                {
                    id: protyle.block.rootID,
                    box: protyle.notebookId,
                    path: protyle.path,
                },
            );
        }
    }

    /* 编辑器点击事件监听器 */
    protected readonly clickEditorContentEventListener = (e: IClickEditorContentEvent) => {
        // this.logger.debug(e);
        const protyle = e.detail.protyle;
        if (protyle.notebookId && protyle.path && protyle.block.rootID) {
            this.bridge.call<IHandlers["addViewEvent"]>(
                "addViewEvent",
                {
                    id: protyle.block.rootID,
                    box: protyle.notebookId,
                    path: protyle.path,
                },
            );
        }
    }

    /* 测试服务状态 */
    public async testService(): Promise<boolean> {
        try {
            const response = await this.client.forwardProxy({
                url: this.wakatimeStatusBarApiUrl,
                method: "GET",
                headers: [this.wakatimeHeaders],
                timeout: this.config.wakatime.timeout * 1_000,
            });
            if (200 <= response.data.status && response.data.status < 300) return true;
            else {
                this.logger.warn(response);
                return false;
            };
        } catch (error) {
            return false;
        }
    }

    /* 获取一个新 ID */
    public get newId(): string {
        return globalThis.Lute.NewNodeID();
    }

    /* default project name */
    public get wakatimeDefaultProject(): string {
        return `siyuan-workspace:${this.wakatimeWorkspaceName}`;
    }

    /* default language name */
    public get wakatimeDefaultLanguage(): string {
        return CONSTANTS.WAKATIME_DEFAULT_LANGUAGE;
    }

    /* default API URL */
    public get wakatimeDefaultApiUrl(): string {
        return CONSTANTS.WAKATIME_DEFAULT_API_URL;
    }

    /* default hostname */
    public get wakatimeDefaultHostname(): string {
        return globalThis.siyuan?.config?.system?.name
            || globalThis.process?.env?.COMPUTERNAME
            || globalThis.process?.env?.USERDOMAIN
            || "unknown";
    }

    /* wakatime user agent */
    public get wakatimeDefaultUserAgent(): string {
        return `${CONSTANTS.WAKATIME_CLIENT_NAME // wakatime 客户端名称
            }/${CONSTANTS.WAKATIME_CLIENT_VERSION // wakatime 客户端版本
            } (${this.wakatimeSystemName // 操作系统名称
            }-${this.wakatimeSystemVersion // 操作系统版本
            }-${this.wakatimeSystemArch // 内核 CPU 架构
            }) ${CONSTANTS.WAKATIME_EDITOR_NAME // 编辑器名称
            }/${this.wakatimeKernelVersion // 编辑器版本
            } ${CONSTANTS.WAKATIME_PLUGIN_NAME // 插件名称
            }/${manifest.version // 插件版本
            }`;
    }

    /* 操作系统名称 */
    public get wakatimeDefaultSystemName(): string {
        return globalThis.siyuan?.config?.system?.os
            || globalThis.process?.platform
            // @ts-ignore userAgentData 为实验性特性
            || globalThis.navigator.userAgentData?.platform
            || globalThis.navigator.platform
            || "unknown";
    }

    /* 操作系统版本 */
    public get wakatimeDefaultSystemVersion(): string {
        return globalThis.require?.("os")?.release?.()
            || "unknown";
    }

    /* 内核名称 */
    public get wakatimeDefaultSystemArch(): string {
        return globalThis.process?.arch
            || "unknown";
    }

    public get wakatimeHeaders(): Context.IHeaders {
        return {
            "Authorization": this.wakatimeAuthorization,
            "User-Agent": this.wakatimeUserAgent,
            "X-Machine-Name": this.wakatimeHostname,
        };
    }

    public get wakatimeWorkspaceDirectory(): string {
        return globalThis.siyuan?.config?.system?.workspaceDir
            || "unknown";
    }

    public get wakatimeWorkspaceName(): string {
        return parse(normalize(this.wakatimeWorkspaceDirectory)).base;
    }

    public get wakatimeKernelVersion(): string {
        return globalThis.siyuan?.config?.system?.kernelVersion
            || "0.0.0";
    }

    /* wakatime API base URL */
    public get wakatimeApiBaseUrl(): string {
        return this.config?.wakatime?.api_url || this.wakatimeDefaultApiUrl;
    }

    /* wakatime statusbar url */
    public get wakatimeStatusBarApiUrl(): string {
        return `${this.wakatimeApiBaseUrl}/${CONSTANTS.WAKATIME_STATUS_BAR_PATHNAME}`;
    }

    /* wakatime statusbar url */
    public get wakatimeHeartbeatsApiUrl(): string {
        return `${this.wakatimeApiBaseUrl}/${CONSTANTS.WAKATIME_HEARTBEATS_PATHNAME}`;
    }

    /* wakatime Authorization */
    public get wakatimeAuthorization(): string {
        return `Basic ${btoa(this.config?.wakatime?.api_key)}`;
    }

    /* wakatime Hostname */
    public get wakatimeHostname(): string {
        return this.config?.wakatime?.hostname
            || this.wakatimeDefaultHostname;
    }

    /* wakatime User Agent */
    public get wakatimeUserAgent(): string {
        return this.config?.wakatime?.useragent
            || this.wakatimeDefaultUserAgent;
    }

    /* wakatime User Agent */
    public get wakatimeProject(): string {
        return this.config?.wakatime?.project
            || this.wakatimeDefaultProject;
    }

    /* wakatime User Agent */
    public get wakatimeLanguage(): string {
        return this.config?.wakatime?.language
            || this.wakatimeDefaultLanguage;
    }

    /* 操作系统名称 */
    public get wakatimeSystemName(): string {
        return this.config?.wakatime?.system_name
            || this.wakatimeDefaultSystemName;
    }

    /* 操作系统版本 */
    public get wakatimeSystemVersion(): string {
        return this.config?.wakatime?.system_version
            || this.wakatimeDefaultSystemVersion;
    }

    /* 内核名称 */
    public get wakatimeSystemArch(): string {
        return this.config?.wakatime?.system_arch
            || this.wakatimeDefaultSystemArch;
    }
};
