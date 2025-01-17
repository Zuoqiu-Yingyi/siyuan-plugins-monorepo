// Copyright (C) 2023 Zuoqiu Yingyi
// 
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
// 
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
// 
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import "./styles/index.less";

import { Client } from "@siyuan-community/siyuan-sdk";
import siyuan from "siyuan";
import { mount } from "svelte";

import { FLAG_MOBILE } from "@workspace/utils/env/front-end";
import { Logger } from "@workspace/utils/logger";
import { mergeIgnoreArray } from "@workspace/utils/misc/merge";
import { compare } from "@workspace/utils/misc/version";
import {
    getBlockMenuContext,
    type BlockMenuDetail,
} from "@workspace/utils/siyuan/menu/block";

import handlers from "@/utils/handlers";

import Settings from "./components/Settings.svelte";

// REF: https://zhuanlan.zhihu.com/p/401882229
import menu from "./assets/symbols/icon-custom-block-menu.symbol?raw";
import danmaku from "./assets/symbols/icon-custom-block-render-danmaku.symbol?raw";
import width_auto from "./assets/symbols/icon-custom-block-width-auto.symbol?raw";
import width_equal from "./assets/symbols/icon-custom-block-width-equal.symbol?raw";
import { DEFAULT_CONFIG } from "./configs/default";
import { MenuItemMode } from "./utils/enums";
import { featureFilter } from "./utils/filter";

import type { IConfig } from "./types/config";

export default class CustomBlockPlugin extends siyuan.Plugin {
    static readonly GLOBAL_CONFIG_NAME = "global-config";
    static readonly ROOT_ATTRIBUTE_NAME = "plugin-custom-block-disabled";

    // @ts-expect-error ignore original type
    declare public readonly i18n: I18N;

    public readonly siyuan = siyuan;
    public readonly logger: InstanceType<typeof Logger>;
    public readonly client: InstanceType<typeof Client>;

    protected readonly SETTINGS_DIALOG_ID: string;

    protected config!: IConfig;

    constructor(options: any) {
        super(options);

        this.logger = new Logger(this.name);
        this.client = new Client();
        this.SETTINGS_DIALOG_ID = `plugin-${this.name}-settings-dialog`;
    }

    public override onload(): void {
        /* 注册图标 */
        this.addIcons([
            menu,
            danmaku,
            width_auto,
            width_equal,
        ].join(""));

        /* 加载数据 */
        this.loadData(CustomBlockPlugin.GLOBAL_CONFIG_NAME)
            .then((config) => {
                this.config = mergeIgnoreArray(DEFAULT_CONFIG, config || {}) as IConfig;
            })
            .catch((error) => this.logger.error(error))
            .finally(() => {
                /* 开始监听块菜单事件 */
                this.eventBus.on("click-blockicon", this.blockMenuEventListener);
                this.eventBus.on("click-editortitleicon", this.blockMenuEventListener);

                this.updateRootAttr();
            });
    }

    public override onLayoutReady(): void {
        if (compare(this.config.version, DEFAULT_CONFIG.version) < 0) {
            /* 需要重置设置选项 */
            siyuan.confirm(
                `${this.i18n.config.reset.title} <code class="fn__code">${this.displayName} [${this.name}]</code>`, // 标题
                this.i18n.config.reset.description, // 文本
                async () => {
                    await this.resetConfig(); // 重置配置
                    globalThis.location.reload(); // 刷新页面
                }, // 确认按钮回调
            );
        }
    }

    public override onunload(): void {
        /* 停止监听块菜单事件 */
        this.eventBus.off("click-blockicon", this.blockMenuEventListener);
        this.eventBus.off("click-editortitleicon", this.blockMenuEventListener);

        this.removeRootAttr();
    }

    public override openSetting(): void {
        // eslint-disable-next-line ts/no-this-alias
        const plugin = this;
        const dialog = new siyuan.Dialog({
            title: `${this.i18n.displayName} <code class="fn__code">${this.name}</code>`,
            content: `<div id="${plugin.SETTINGS_DIALOG_ID}" class="fn__flex-column" />`,
            width: FLAG_MOBILE ? "92vw" : "720px",
            height: FLAG_MOBILE ? undefined : "640px",
        });
        const target = dialog.element.querySelector(`#${plugin.SETTINGS_DIALOG_ID}`);
        if (target) {
            mount(Settings, {
                target,
                props: {
                    config: this.config,
                    plugin: this,
                },
            });
        }
    }

    /* 添加块菜单项 */
    protected readonly blockMenuEventListener = (e: CustomEvent<BlockMenuDetail>) => {
        // this.logger.debug(e);
        const detail = e.detail; // 获取菜单信息
        const context = getBlockMenuContext(detail); // 获取块菜单上下文

        if (context) {
            const submenu: siyuan.IMenu[] = []; // 下级菜单

            /* 获得可使用的功能 */
            const features = this.config.features
                .filter((feature) => featureFilter(feature, context))
                .filter((feature, index, array) => {
                    switch (feature.mode) {
                        case MenuItemMode.separator:
                            if (index === 0 || index === array.length - 1) { // 移除首尾的分割线
                                return false;
                            }
                            else { // 移除重复的分割线
                                return array[index - 1]?.mode !== MenuItemMode.separator;
                            }
                        default:
                            return true;
                    }
                });

            /* 生成菜单项 */
            features.forEach((feature) => {
                switch (feature.mode) {
                    /* 文本输入框 */
                    case MenuItemMode.input: {
                        /* 派遣多个编辑任务: 如需编辑多个属性, 则需多个输入框 */
                        feature.tasks?.forEach((task) => {
                            submenu.push({
                                id: feature.id,
                                element: globalThis.document.createElement("div"), // 避免生成其他内容
                                disabled: !feature.enable,
                                bind: (element) => handlers[task.type](
                                    this,
                                    feature,
                                    context,
                                    {
                                        element,
                                        ...task.params,
                                    },
                                ),
                            });
                        });
                        break;
                    }
                    /* 按钮 */
                    case MenuItemMode.button: {
                        submenu.push({
                            id: feature.id,
                            icon: feature.icon,
                            label: this.i18n.menu[feature.id].label,
                            accelerator: feature.accelerator,
                            disabled: !feature.enable,
                            click: async () => {
                                for (const task of (feature.tasks ?? [])) {
                                    await handlers[task.type](
                                        this,
                                        feature,
                                        context,
                                        task.params,
                                    );
                                }
                            },
                        });
                        break;
                    }
                    /* 分割线 */
                    case MenuItemMode.separator: {
                        submenu.push({
                            type: "separator",
                        });
                        break;
                    }
                    default:
                        break;
                }
            });

            detail.menu.addItem({
                icon: "icon-custom-block-menu",
                label: this.i18n.displayName,
                submenu,
            });
        }
    };

    /* 重置插件配置 */
    public async resetConfig(): Promise<void> {
        return this.updateConfig(mergeIgnoreArray(DEFAULT_CONFIG) as IConfig);
    }

    /* 更新插件配置 */
    public async updateConfig(config?: IConfig): Promise<void> {
        if (config && config !== this.config) {
            this.config = config;
        }
        this.updateRootAttr();
        return this.saveData(CustomBlockPlugin.GLOBAL_CONFIG_NAME, this.config);
    }

    /* 更新根节点属性 */
    public updateRootAttr() {
        // const features = this.config.features.filter(feature => feature.enable && feature.style && feature.token); // 激活的功能
        const features = this.config.features.filter((feature) => !(feature.enable && feature.style && feature.token)); // 禁用的功能
        const tokens = features.map((feature) => feature.token); // 禁用的功能令牌列表

        /* 设置 HTML 根节点的属性 */
        globalThis.document.documentElement.setAttribute(
            CustomBlockPlugin.ROOT_ATTRIBUTE_NAME,
            tokens.join(" "),
        );
    }

    /* 移除根节点属性 */
    public removeRootAttr() {
        globalThis.document.documentElement.removeAttribute(CustomBlockPlugin.ROOT_ATTRIBUTE_NAME);
    }
};
