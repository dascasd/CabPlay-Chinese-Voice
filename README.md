# CabPlay 中文语音导航增强

把 [CabPlay](https://github.com/Ku3rb1s/CabPlay) 的语音播报重做成「高德地图式」详细中文播报。

主要改进：**时间触发 + 语音时长补偿**（`D_trigger = D_ref + V×T_speech`，语音在参考点恰好结束）、**三层播报**（L1 预告 / L2 准备 / L3 执行）、**车道 SET/SINGLE 引导**（「请走左侧第 2 车道」/「请走左侧 2 车道」）、**播报优先级打断**（P0/P1 打断 P2/P3）、并修正了部分左右方向识别、让设置搜索支持中文。

> 基于 CabPlay **v1.20.1**。原项目：[Ku3rb1s/CabPlay](https://github.com/Ku3rb1s/CabPlay)

## 改了什么

| 文件 | 改动 |
|---|---|
| `ui/app.js` | 转向播报重写（时间触发三层）、车道引导 SET/SINGLE、播报优先级队列、设置搜索支持中文 |
| `ui/defaults.js` | 默认开启「播报转弯」「弯道提醒」 |
| `ui/map.js` | 修正角度判定左右反转（与游戏数据一致） |
| `ui/i18n-zh.js` / `zh-hant` / `en` / `pl` / `tr` | 新增播报语句翻译（环岛、车道等） |

完整设计见 [指南.txt](指南.txt)。

## 怎么用

### 方式一：直接用打包好的 app.asar（最简单）

到本仓库 [Releases](../../releases) 下载 `app.asar`，覆盖 CabPlay 安装目录下的 `resources\app.asar`（**覆盖前先备份原文件**），重启 CabPlay 和游戏即可。

### 方式二：自己从源码打包

1. 从 CabPlay 安装目录复制出 `resources\app.asar`
2. 解包：
   ```
   node tools\asar-extract.js <你的app.asar> <解包目录>
   ```
3. 用本仓库 `ui\` 下的同名文件覆盖解包目录里的文件
4. 重新打包：
   ```
   node tools\asar-pack.js <原app.asar> <解包目录> <新app.asar>
   ```
5. 把新 `app.asar` 放回 `resources\`，重启

## 说明

- 中文语音需要 Windows 安装中文语音包（Microsoft Huihui / Xiaoxiao）
- 本仓库仅包含对 CabPlay 的**改动文件**和打包工具；CabPlay 本身版权归 [Ku3rb1s](https://github.com/Ku3rb1s/CabPlay)，本增强为非官方衍生，遵循原项目许可
