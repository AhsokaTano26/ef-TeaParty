# 欢迎页标识组合

依据用户提供的《重庆大学视觉形象识别系统手册（VIS手册）.pdf》印刷页码第 4、28–29 页，采用校徽在左、偶研标识在右的并列关系，下方显示单位中英文名称。组合本身透明，不再添加白色矩形。校徽保持用户提供的透明 PNG 原图。

中文：重庆大学动漫社偶研部。

英文暂用直译：Idol Research Department, Animation Club / Chongqing University。该英文由本项目暂拟，不作为社团官方英文名。

偶研原图保留在 `web/src/assets/cqu-ouyan-logo.png`；透明版本保存为 `web/src/assets/cqu-ouyan-logo-transparent.png`。使用内置 imagegen 编辑工具移除外部白底，保留内部白色。透明版本为 1254 × 1254 PNG，带 alpha 通道，已在可见 Microsoft Edge 中检查首页全屏显示。原图未覆盖。

本次使用的完整提示词：

```text
Use case: background-extraction. Edit target: the supplied Chongqing University Idol Research Department badge. Remove ONLY the exterior off-white paper background to actual alpha transparency. Preserve the entire existing badge artwork exactly: the green central rectangle, all six colored side stripes, the white frame and white Chinese characters "重大偶研", the orange C, red Q, orange U, and the white building line art. Keep all white areas INSIDE the main badge opaque, including the letter counters and frame. The exterior gaps between the six stripes and the outer margin should be transparent. Do not redesign, recolor, rewrite, add text, change the geometry or crop any of the colored stripes. Keep the original square framing and relative placement, with a clean transparent margin.
```
