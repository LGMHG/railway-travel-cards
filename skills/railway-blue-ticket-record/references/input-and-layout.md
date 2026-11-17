# 行程输入

输入为 UTF-8 JSON 对象或按交付顺序排列的对象数组。[虚构示例](../assets/demo-trip.json)可以直接运行。

| 字段 | 填写方式 |
| --- | --- |
| `date`、`train`、`departure`、`arrival` | 普通行程必填。日期用 YYYY-MM-DD；站名可带「站」。 |
| `time`、`fare` | 可选。发站开车时间为 HH:MM；票价以元为单位，零与空值分开。需要保留两位小数时用字符串，如 `"23.50"`。 |
| `departure_en`、`arrival_en` | 选填站名拼音，电子发票有拼音时可直接采用。 |
| `coach`、`seat`、`seat_class` | 分别填写车厢号、座号和席别。数字座号显示三位，动车字母座号数字部分至少两位。无座使用 `standing: true` 或席别「无座」。 |
| `berth` | 可选「上铺」「中铺」「下铺」。座号填铺号。 |
| `record_type` | 改签费用 `change_fee`，金额用 `fee` 或旧批次的 `fare`。关联行程用 `related` 或原车次和区间。 |
| `name`、`id_number` | 都可留空。已打码的号码保持原样。 |
| `identityMode` | `auto` 默认，完整大陆身份证显示前六位与后四位；`raw` 原样显示；`hide` 隐藏。票根和随附 JSON 使用所选显示值。原样模式的交付文件会含输入的完整号码。 |
| `id` | 可选输出文件名，仅用 ASCII 字母、数字、下划线和短横线。旧批次保留原 id。缺省时按行程生成，重复记录可指定不同 id。 |
| `serial`、`footer` | 可选的个人排版编号，原批次有值时保留，缺省时根据 id 确定性生成。 |
| `provenance` | 可选来源说明。如补全时刻或票价，记录字段、来源 URL、资料日期和查询日期。来源说明中仅保留必要信息。 |

电子发票附件可按元素的本地名称读取。乘车日期用 `TravelDate`，时间用 `DepartureTime`，区间用 `DepartureStation` 和 `DestinationStation`，金额用 `Fare`，乘客用 `Name`。车次、车厢、席位对应 `TrainNumber`、`Carriage`、`Seat`；将「13车」「008号」整理为 `"13"`、`"008"`。同一个 PDF 同时含 XML 和票面文字时只录入一次。

固定底图和坐标由技能内 `assets/blue-ticket-base.png` 和 `assets/layout.json` 提供。维护渲染器后运行 `python scripts/check_renderer.py`，检查静态底图、输出像素、隐私显示和批量行为。

## 2026 年车次兼容

识别支持新增旅客车次字头 N、V、X，并兼容历史 T、K、Z、L、A 和纯数字车次。按订单、发票或用户核对的车次生成票根，保留该次行程的原始车次。新旧车次映射需核对铁路官方对照及适用日期，数字号段也可能调整。

2026 年 11 月 25 日零时起始发的普速旅客列车启用 Z、N、V 编排，旅游列车使用 Y。动车组相关调整安排在 12 月下旬，具体日期以铁路后续公告为准。新版 T、K 用于动车组，查询席别和票价时应结合乘车日期及实际资料。X 为新编旅客车次字头，支持识别不表示对应列车已经开行。[12306 公告](https://mobile.12306.cn/mormhweb/zxdt/202611/t20261105_46591.html) · [中国铁路新版编排说明](https://news.cri.cn/20261016/36d328ca-d415-4ad7-9967-503d4fdd9f11.html)
