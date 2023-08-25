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
import type { ISiyuanGlobal } from "@workspace/types/siyuan";

import manifest from "~/public/plugin.json";

import "./index.less";
import icon_jupyter_client from "./assets/symbols/icon-jupyter-client.symbol?raw";
import icon_jupyter_client_simple from "./assets/symbols/icon-jupyter-client-simple.symbol?raw";
import icon_jupyter_client_kernelspec from "./assets/symbols/icon-jupyter-client-kernelspec.symbol?raw";
import icon_jupyter_client_kernel from "./assets/symbols/icon-jupyter-client-kernel.symbol?raw";
import icon_jupyter_client_kernel_unknown from "./assets/symbols/icon-jupyter-client-kernel-unknown.symbol?raw";
import icon_jupyter_client_kernel_starting from "./assets/symbols/icon-jupyter-client-kernel-starting.symbol?raw";
import icon_jupyter_client_kernel_idle from "./assets/symbols/icon-jupyter-client-kernel-idle.symbol?raw";
import icon_jupyter_client_kernel_busy from "./assets/symbols/icon-jupyter-client-kernel-busy.symbol?raw";
import icon_jupyter_client_kernel_terminating from "./assets/symbols/icon-jupyter-client-kernel-terminating.symbol?raw";
import icon_jupyter_client_kernel_restarting from "./assets/symbols/icon-jupyter-client-kernel-restarting.symbol?raw";
import icon_jupyter_client_kernel_autorestarting from "./assets/symbols/icon-jupyter-client-kernel-autorestarting.symbol?raw";
import icon_jupyter_client_kernel_dead from "./assets/symbols/icon-jupyter-client-kernel-dead.symbol?raw";
import icon_jupyter_client_session from "./assets/symbols/icon-jupyter-client-session.symbol?raw";
import icon_jupyter_client_session_console from "./assets/symbols/icon-jupyter-client-session-console.symbol?raw";
import icon_jupyter_client_session_notebook from "./assets/symbols/icon-jupyter-client-session-notebook.symbol?raw";

import {
    Client,
    type types,
} from "@siyuan-community/siyuan-sdk";

import Item from "@workspace/components/siyuan/menu/Item.svelte"
import Settings from "./components/Settings.svelte";
import JupyterDock from "./components/JupyterDock.svelte";

import {
    FLAG_MOBILE,
} from "@workspace/utils/env/front-end";
import {
    getBlockMenuContext,
} from "@workspace/utils/siyuan/menu/block";
import { Logger } from "@workspace/utils/logger";
import { fn__code } from "@workspace/utils/siyuan/text/span";
import { mergeIgnoreArray } from "@workspace/utils/misc/merge";
import { WorkerBridgeMaster } from "@workspace/utils/worker/bridge/master";
import { sleep } from "@workspace/utils/misc/sleep";

import CONSTANTS from "./constants";
import { DEFAULT_SETTINGS } from "./jupyter/settings";
import { DEFAULT_CONFIG } from "./configs/default";

import type { I18N } from "./utils/i18n";
import type { IConfig } from "./types/config";
import type {
    KernelSpec,
    Kernel,
    Session,
} from "@jupyterlab/services";
import type {
    IClickBlockIconEvent,
    IClickEditorTitleIconEvent,
} from "@workspace/types/siyuan/events";
import type {
    IHandlers,
    THandlersWrapper,
} from "@workspace/utils/worker/bridge";
import type { WorkerHandlers } from "./workers/jupyter";

declare var globalThis: ISiyuanGlobal;
export type PluginHandlers = THandlersWrapper<TemplatePlugin["handlers"]>;

export default class TemplatePlugin extends siyuan.Plugin {
    static readonly GLOBAL_CONFIG_NAME = "global-config";

    declare public readonly i18n: I18N;

    public readonly siyuan = siyuan;
    public readonly logger: InstanceType<typeof Logger>;
    public readonly client: InstanceType<typeof Client>;

    protected readonly SETTINGS_DIALOG_ID: string;

    public config: IConfig = DEFAULT_CONFIG;
    protected worker?: InstanceType<typeof Worker>; // worker
    public bridge?: InstanceType<typeof WorkerBridgeMaster>; // worker 桥

    protected jupyterDock!: {
        // editor: InstanceType<typeof Editor>,
        dock: ReturnType<siyuan.Plugin["addDock"]>,
        model?: siyuan.IModel,
        component?: InstanceType<typeof JupyterDock>,
    }; // Jupyter 管理面板

    public readonly handlers;

    constructor(options: any) {
        super(options);

        this.logger = new Logger(this.name);
        this.client = new Client(undefined, "fetch");

        this.SETTINGS_DIALOG_ID = `${this.name}-settings-dialog`;
        this.handlers = {
            updateKernelSpecs: {
                this: this,
                func: this.updateKernelSpecs,
            },
            updateKernels: {
                this: this,
                func: this.updateKernels,
            },
            updateSessions: {
                this: this,
                func: this.updateSessions,
            },
        } as const;
    }

    onload(): void {
        // this.logger.debug(this);

        /* 注册图标 */
        this.addIcons([
            icon_jupyter_client,
            icon_jupyter_client_simple,
            icon_jupyter_client_kernelspec,
            icon_jupyter_client_kernel,
            icon_jupyter_client_kernel_unknown,
            icon_jupyter_client_kernel_starting,
            icon_jupyter_client_kernel_idle,
            icon_jupyter_client_kernel_busy,
            icon_jupyter_client_kernel_terminating,
            icon_jupyter_client_kernel_restarting,
            icon_jupyter_client_kernel_autorestarting,
            icon_jupyter_client_kernel_dead,
            icon_jupyter_client_session,
            icon_jupyter_client_session_console,
            icon_jupyter_client_session_notebook,
        ].join(""));

        /* 注册侧边栏 */
        const plugin = this;
        this.jupyterDock = {
            dock: this.addDock({
                config: {
                    position: "LeftTop",
                    size: { width: 256, height: 0 },
                    icon: "icon-jupyter-client",
                    title: this.i18n.dock.title,
                    show: true,
                },
                data: {
                },
                type: "-dock",
                init() {
                    // plugin.logger.debug(this);

                    this.element.classList.add("fn__flex-column");
                    const dock = new JupyterDock({
                        target: this.element,
                        props: {
                            plugin,
                            ...this.data,
                        },
                    });
                    plugin.jupyterDock.model = this;
                    plugin.jupyterDock.component = dock;
                },
                destroy() {
                    plugin.jupyterDock.component?.$destroy();
                    delete plugin.jupyterDock.component;
                    delete plugin.jupyterDock.model;
                },
            }),
        };

        this.loadData(TemplatePlugin.GLOBAL_CONFIG_NAME)
            .then(config => {
                this.config = mergeIgnoreArray(DEFAULT_CONFIG, config || {}) as IConfig;
            })
            .catch(error => this.logger.error(error))
            .finally(async () => {
                /* 初始化 channel */
                this.initBridge();
                const runing = await this.isWorkerRunning();

                if (!runing) { // worker 未正常运行
                    /* 初始化 worker */
                    this.initWorker();

                    /* 等待 worker 正常运行 */
                    while (await this.isWorkerRunning()) {
                        await sleep(1_000)
                    }

                    /* 初始化 worker 配置 */
                    await this.bridge?.call<WorkerHandlers["onload"]>("onload");
                    await this.updateWorkerConfig();
                }

                this.eventBus.on("click-editortitleicon", this.blockMenuEventListener);
                this.eventBus.on("click-blockicon", this.blockMenuEventListener);
            });
    }

    onLayoutReady(): void {
        // @ts-ignore
        // globalThis.jupyter = new Jupyter(
        //     this.config.jupyter.server.settings,
        //     this.logger,
        //     (...args: any[]) => null,
        //     (...args: any[]) => null,
        //     (...args: any[]) => null,
        // );
    }

    onunload(): void {
        this.eventBus.off("click-editortitleicon", this.blockMenuEventListener);
        this.eventBus.off("click-blockicon", this.blockMenuEventListener);

        this.bridge
            ?.call<WorkerHandlers["unload"]>("unload")
            .then(() => {
                this.bridge?.terminate();
                this.worker?.terminate();
            });
    }

    openSetting(): void {
        const that = this;
        const dialog = new siyuan.Dialog({
            title: `${this.i18n.displayName} <code class="fn__code">${this.name}</code>`,
            content: `<div id="${that.SETTINGS_DIALOG_ID}" class="fn__flex-column" />`,
            width: FLAG_MOBILE ? "92vw" : "720px",
            height: FLAG_MOBILE ? undefined : "640px",
        });
        const target = dialog.element.querySelector(`#${that.SETTINGS_DIALOG_ID}`);
        if (target) {
            const settings = new Settings({
                target,
                props: {
                    config: this.config,
                    plugin: this,
                },
            });
        }
    }

    /* 重置插件配置 */
    public async resetConfig(): Promise<void> {
        return this.updateConfig(mergeIgnoreArray(DEFAULT_CONFIG) as IConfig);
    }

    /* 更新插件配置 */
    public async updateConfig(config?: IConfig): Promise<void> {
        if (config && config !== this.config) {
            this.config = config;
        }
        await this.updateWorkerConfig();
        await this.saveData(TemplatePlugin.GLOBAL_CONFIG_NAME, this.config);
    }

    /* 初始化通讯桥 */
    protected initBridge(): void {
        this.bridge?.terminate();
        this.bridge = new WorkerBridgeMaster(
            new BroadcastChannel(CONSTANTS.JUPYTER_WORKER_BROADCAST_CHANNEL_NAME),
            this.logger,
            this.handlers,
        );
    }

    /* 初始化 worker */
    protected initWorker(): void {
        this.worker?.terminate();
        this.worker = new Worker(
            `${globalThis.document.baseURI}plugins/${this.name}/workers/${CONSTANTS.JUPYTER_WORKER_FILE_NAME}.js?v=${manifest.version}`,
            {
                type: "module",
                name: this.name,
                credentials: "same-origin",
            },
        );
    }

    /* web worker 是否正在运行 */
    protected async isWorkerRunning(): Promise<boolean> {
        try {
            /* 若 bridge 未初始化, 需要初始化 */
            if (!this.bridge) this.initBridge();

            /* 检测 Worker 是否已加载完成 */
            await this.bridge!.ping();
            return true;
        }
        catch (error) {
            return false;
        }
    }

    public get baseUrl(): string {
        return this.config?.jupyter.server.settings.baseUrl || DEFAULT_SETTINGS.baseUrl;
    }


    /* 更新 worker 配置 */
    public async updateWorkerConfig(): Promise<void> {
        await this.bridge?.call<WorkerHandlers["updateConfig"]>(
            "updateConfig",
            this.config,
        );
        await this.bridge?.call<WorkerHandlers["restart"]>("restart");
    }

    /**
     * jupyter 请求
     */
    public jupyterFetch(
        pathname: string,
        init: RequestInit = {},
    ): Promise<Response> {
        const url = new URL(this.baseUrl);
        if (pathname.startsWith("/")) {
            url.pathname = pathname;
        }
        else {
            url.pathname = `${url.pathname}/${pathname}`;
        }

        const headers: Record<string, string> = {
            Authorization: `token ${this.config.jupyter.server.settings.token}`,
        };

        if (init.headers) {
            Object.assign(headers, init.headers);
        }
        else {
            init.headers = headers;
        }

        return globalThis.fetch(
            url,
            init,
        );
    }

    /* 块菜单菜单弹出事件监听器 */
    protected readonly blockMenuEventListener = (e: IClickBlockIconEvent | IClickEditorTitleIconEvent) => {
        // this.logger.debug(e);

        const detail = e.detail;
        const context = getBlockMenuContext(detail); // 获取块菜单上下文
        if (context) {
            const submenu: siyuan.IMenuItemOption[] = [];
            if (context.isDocumentBlock) {
                /* 会话管理 */
                
                /* *.ipynb 文件导入 */
                submenu.push({
                    icon: "iconUpload",
                    label: this.i18n.menu.import.label,
                    accelerator: fn__code(this.i18n.menu.import.accelerator),
                    submenu: [
                        { // 覆写
                            element: globalThis.document.createElement("div"), // 避免生成其他内容
                            bind: element => {
                                /* 挂载一个 svelte 菜单项组件 */
                                const item = new Item({
                                    target: element,
                                    props: {
                                        file: true,
                                        icon: "#iconEdit",
                                        label: this.i18n.menu.override.label,
                                        accept: ".ipynb",
                                        multiple: false,
                                        webkitdirectory: false,
                                    },
                                });

                                item.$on("selected", async e => {
                                    // this.plugin.logger.debug(e);
                                    const files = e.detail.files;
                                    const file = files.item(0);
                                    if (file) {
                                        await this.bridge?.call<WorkerHandlers["importIpynb"]>(
                                            "importIpynb",
                                            context.id,
                                            file,
                                            "override",
                                        );
                                    }
                                });
                            },
                        },
                        { // 追加
                            element: globalThis.document.createElement("div"), // 避免生成其他内容
                            bind: element => {
                                /* 挂载一个 svelte 菜单项组件 */
                                const item = new Item({
                                    target: element,
                                    props: {
                                        file: true,
                                        icon: "#iconAfter",
                                        label: this.i18n.menu.append.label,
                                        accept: ".ipynb",
                                        multiple: false,
                                        webkitdirectory: false,
                                    },
                                });

                                item.$on("selected", async e => {
                                    // this.plugin.logger.debug(e);
                                    const files = e.detail.files;
                                    const file = files.item(0);
                                    if (file) {
                                        await this.bridge?.call<WorkerHandlers["importIpynb"]>(
                                            "importIpynb",
                                            context.id,
                                            file,
                                            "append",
                                        );
                                    }
                                });
                            },
                        },
                    ]
                })
            }

            detail.menu.addItem({
                submenu,
                icon: "icon-jupyter-client-simple",
                label: this.i18n.displayName,
                accelerator: this.name,
            });
        }
    };

    /* 内核清单更改 */
    public readonly updateKernelSpecs = (kernelspecs: KernelSpec.ISpecModels) => {
        // this.logger.debug(kernelspecs);
        this.jupyterDock.component?.$set({
            kernelspecs,
        });
    }

    /* 活动的内核列表更改 */
    public readonly updateKernels = (kernels: Kernel.IModel[]) => {
        // this.logger.debug(kernels);
        this.jupyterDock.component?.$set({
            kernels,
        });
    }

    /* 活动的会话列表更改 */
    public readonly updateSessions = (sessions: Session.IModel[]) => {
        // this.logger.debug(sessions);
        this.jupyterDock.component?.$set({
            sessions,
        });
    }
};
