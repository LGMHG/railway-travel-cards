# 12306铁路报销凭证打印生成

在浏览器里填写个人乘车记录，或导入已经从铁路 12306 下载的官方 PDF，预览、排序并排印。生成的蓝色票面带有“个人行程记录”字样，仅用于旅行留念。需要报销时请使用 12306 开具的电子发票。[铁路 12306 电子发票说明](https://passport.12306.cn/otn/view/invoice_index.html)

![v03 蓝色圆角票面（虚构示例）](examples/preview.png)

## 怎么用

1. 选择“填写行程”，输入乘车日期、车次、出发站和到达站。时间、席别、车厢、座位、票价、姓名和证件号均可留空。证件号默认自动打码，可选原样显示或不显示。卧铺可选铺位，无座自动隐藏座号。添加改签费时填写日期与金额即可。
2. 选择“电子发票”可批量读取铁路电子客票。优先读取随票 XML，其次读取页面文字，扫描件在本机识别。核对后生成同款 v03 蓝色票根。需要原版时可展开“按原尺寸打印官方 PDF”。
3. 在清单中勾选记录，上移或下移调整顺序。点击记录名称查看票面，蓝色票根可以再次编辑。
4. 选择输出方式，查看排版预览，导出文件。刷新或关闭页面会清空本次录入和导入的内容。

| 导出方式 | 文件内容 |
| --- | --- |
| A4 十张打印 PDF | 纵向两列五行。蓝色记录图宽 85.6 毫米，纵横间隔均为 2 毫米。超过十张自动分页，末页保留原位置。PDF 来源页面等比放入格内。 |
| 官方 PDF 原尺寸 | 仅勾选导入页时默认选中。按页面原尺寸和清单顺序输出。单份完整原序文件直接返回原 PDF。 |
| 单张 PNG | 勾选一项。蓝色票根为 1586 × 992 像素，附 300 DPI 元数据，导入页保持原比例。 |
| 多张拼图 PNG | 勾选至少两项，按清单顺序从左至右双列拼接。长拼图会等比降低分辨率，以适应浏览器画布。 |

打印 A4 十格 PDF 时选择 **A4、纵向、实际大小／100%**。导入的整页发票缩入十格后字会变小，可改选原尺寸。原文件请自行留存。

## 批量导入

打开“批量导入行程”，粘贴一行一趟的文字、从 Excel 复制带列名的表格，或选择多张 PNG、JPG、WebP 截图。文字示例为「2025-10-08 DEMO01 云灯谷→星栖湾 二等座」。表格可使用日期、车次、出发站、到达站、席别、发车时间、票价等列名。旧渲染器的单条 JSON 或批量数组也可直接导入。

首次选择图片时，浏览器从本站加载 Tesseract.js 和中英文识别模型。订单按卡片和乘车人拆分，积分详情优先读取弹窗。点“核对”可同时查看原图、原始识别文字、字段及查询来源。对不清楚的姓名或金额，可在这里改正。重复图片会被跳过；身份明确的疑似重复行程可手动比较合并。可在导入前填写“本次默认乘车人”，自动补空，或手动应用到勾选记录。已有姓名不同时不自动套用默认乘客的证件号。DEMO 车次跳过联网查询。

点击“查询缺失信息”才会向站点查询服务发送乘车日期、车次、起终点、席别和铺位。查询结果先显示为候选；同一批次可一次采用。已填金额、时间以及积分订单里的票面显示金额优先。服务不可用时，可手动补录或留空。点击“将已就绪的 N 条加入排印”，再在下方清单选择导出方式。已加入的行不会再次提交。

## 配置免费联网查询（站点维护者）

查询后端在 Cloudflare Workers Free 上运行，一个 SQLite-backed Durable Object 持久记录全站上游调用次数并缓存当日结果。只使用供应商账号中已开通的免费次数。下面的额度是**全站自启用后的累计上限**；配置为独占该应用的免费接口剩余次数（最多 50），默认为 0。请求发出前先预留一次；即使上游超时，该次也计入本地预算。请在供应商端关闭付费续用，保留同一额度对象与名称。[供应商接口与套餐](https://m.jisuapi.com/api/train/)

1. 在 Cloudflare 免费账户登录 Wrangler，在「worker/wrangler.toml」把 SITE_ORIGIN 改为本站的源（协议加域名），FREE_CALL_LIMIT 填首次启用时已确认的剩余免费次数。
2. 在项目根目录运行以下命令。在交互提示中输入极速数据密钥，密钥仅保存在 Worker Secret 中。

```sh
npx wrangler@4 login
npx wrangler@4 deploy --config worker/wrangler.toml
npx wrangler@4 secret put JISU_APPKEY --config worker/wrangler.toml
```

3. 在 GitHub 仓库的 Actions Variables 中设置 RAIL_LOOKUP_URL，取 Worker 部署返回的 HTTPS 地址加上 /lookup，再运行 Pages 工作流。本地测试可将同名环境变量设为本地 Worker 地址后重新构建，SITE_ORIGIN 须匹配本地前端源。前端仅保存服务地址。
4. 用一趟公开行程检查真实查询、来源日期和余额。过去日期的上游结果只有明确匹配服务日期时才作为当日资料，否则尝试查询现行值。默认零额度、上游额度耗尽或没有密钥时，网站会提示原因。

## Codex 技能

[railway-blue-ticket-record](skills/railway-blue-ticket-record/SKILL.md) 可在本机按同一 v03 版式离线生成个人票根。将整个 `skills/railway-blue-ticket-record` 目录复制到 Codex 的用户技能目录，开启新会话后使用 `$railway-blue-ticket-record`。技能附有虚构示例和 Python 命令，依赖 Pillow 与系统中文字体。

## 本地运行

需要 Node.js 24、npm 和静态 HTTP 服务。以下示例使用 Python 3 启动本地预览。

```sh
npm ci --omit=optional --ignore-scripts
npm test
npm run build
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

浏览器打开 `http://127.0.0.1:8000/`。可从任意静态 HTTP(S) 站点的子目录提供构建好的 `dist/`。页面、字体、PDF.js 工作线程和解码资源均由本站提供，图片、OCR 文字、姓名、证件号和 PDF 都在浏览器内处理。联网补全仅发送上文列出的行程字段。

## GitHub Pages

在仓库 Settings → Pages 中选择 GitHub Actions 作为发布来源。推送到 main 或手动运行 Publish GitHub Pages 工作流即可构建并部署静态站点。

## 票面版式

网页直接读取 railway-blue-ticket-record 技能的 v03 固定底图与 layout.json。站名、拼音、日期、票价、座位、乘车人、红色编号和底部编码按各自字段框绘制。站名拼音自动生成，也可以在补充信息中校正。编号由行程标识生成，二维码是底图上的固定装饰图案。蓝色票根右上角标注“个人行程记录”。

浏览器优先使用设备已安装的宋体、Times New Roman 和 Arial，缺少对应字体时使用随站点分发的 Noto Serif SC 及系统后备字体。

## 许可和素材

- 项目代码和虚构行程示例使用 [MIT 许可证](LICENSE)。
- [Noto Serif SC](https://fontsource.org/fonts/noto-serif-sc) 使用 SIL Open Font License 1.1，随网站分发的字体保留许可文件。
- [PDF.js](https://github.com/mozilla/pdf.js) 使用 Apache-2.0，[pdf-lib](https://github.com/Hopding/pdf-lib) 使用 MIT；构建时同时复制它们的许可及 PDF.js 随附资源的许可。
- 蓝色背景来自本项目先前生成的 v03 空白样张，已移除可变行程字段。站名转写使用 pinyin-pro（MIT）。
- 截图识别使用 [Tesseract.js](https://github.com/naptha/tesseract.js)、tesseract.js-core 与 Tesseract 的简体中文和英文训练数据，相关许可随本地 OCR 资源分发。
