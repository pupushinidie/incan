# 印加宝藏（incan）

3–8 人网页联机桌游：大家一起钻进神庙，一张张翻牌分宝石。每翻一张，神庙里的人**同时**决定「继续挖」还是「带着宝石回营地」；同一种危险第二次出现就塌方，还在里面的人这一局白干。一共 5 局，帐篷里的宝石加神器分最高的人赢。

- 线上：gulugagame.com/incan（还没上线）
- 本地：服务器 3019，网页 5192（`SERVER_PORT` / `WEB_PORT` 可改，见下）
- 仓库从多米诺王国（kingdomino@89bebe4）复制：它是带全站人机 / 托管 / 观战 / 挤登录 / 开房选项的最新模板；同时决定的部分参考了翻七（按「谁还没决定」安排计时和人机）。

## 怎么玩（用自己的话写的规则说明）

**配件**：宝物卡 15 张（宝石数 1、2、3、4、5、5、7、7、9、11、11、13、14、15、17，共 124 颗）；危险卡 5 种（火焰、木乃伊、落石、蛇、蜘蛛）各 3 张；神器 5 件。每人一顶帐篷。

**一局怎么走**：

1. 开局把宝物、剩下的危险、牌堆里的神器洗在一起，所有人站在神庙入口。每局开始时往牌堆里**新放 1 件神器**（第 n 局放第 n 件）；以前没翻出来的神器还留在牌堆里，所以后面的局一条路上可能出现好几件。
2. 翻开牌堆顶一张，放到路上：
   - **宝物**：还在神庙里的人平分，除不尽的余数留在路上。例：4 个人翻出 11 → 每人 2 颗，路上留 3 颗。
   - **危险**：这一局第一次出现这种危险，什么也不发生；**同一种第二次出现就塌方**：还在神庙里的人这一局带着的宝石全丢，这一局结束，那张第二次出现的危险牌永久拿出游戏（同一种最多被拿掉两次）。
   - **神器**：放在路上，暂时谁也不拿。
3. 没塌方的话，神庙里的人同时决定继续还是离开（可以改主意，最后一个人决定之前都能撤回）。大家都决定了一起亮出：
   - **离开的人**平分路上的余数（还除不尽的继续留在路上），连同这一局手上的宝石一起存进帐篷，以后再也不会丢。这一局不能再回来。
   - 如果**只有一个人离开**，他把路上所有神器都拿走；两个人以上同时离开，谁也拿不到，神器继续躺在路上。
   - 选继续的人留下，接着翻下一张。
4. 所有人都离开、或者塌方，这一局结束。路上没人分的余数宝石、没人拿的神器都作废。

**两个小便利（官方允许）**：每局第一张翻牌前不用决定；第一张就是危险时也不用决定（离开什么都拿不到），直接翻下一张，界面弹一句提示。

**计分**：帐篷里 1 颗宝石 1 分。神器按**整局带出神庙的先后**算分：第 1、2、3 件各 5 分，第 4、5 件各 10 分；作废的神器不算件数。打完 5 局总分最高的人赢；同分比神器件数；再一样就并列获胜。

**谁能看到什么**：路上的牌、路上的余数、谁还在神庙、每个人这一局带着多少宝石（神庙里的人一定一样多）、谁带出了几件神器、谁在第几张牌后离开，都公开。**帐篷里的宝石只有自己看得到**（真想知道别人有多少，得自己记）。大家决定时只看得到谁「已决定」，看不到选了什么，亮出时才公开。牌堆顺序谁也看不到。

## 默认规则表（规则书没写死、开工拍板、全站约定）

| 项目 | 这里的做法 | 出处 |
|---|---|---|
| 宝物卡张数 | 15 张，含 17 那张（BGA 只有 14 张） | 规则书待确认 #1、补充 3.1 |
| 神器分值 | 按带出顺序 5/5/5/10/10，作废的不占序号；没有「第 5 局翻倍」 | 待确认 #2 #3、勘误 E3 |
| 没翻出来的神器 | 留在牌堆带到下一局（官方），一条路上可以有多件，单独离开的人一次全拿，按带出顺序逐件编号 | 勘误 E1，开工拍板 |
| 危险移出 | 塌方的那张永久移出，同一种可以移出两次（每种 0–2） | 勘误 E2 |
| 局末余数 | 全员离开或塌方时，路上的余数宝石作废，不带到下一局 | 勘误 E4 |
| 局末路上的神器 | 作废（两种结束方式都一样）；牌堆里没翻出的不动 | 勘误 E5 |
| 第一张就是危险 | 不用决定，直接翻下一张，发 `FirstHazardSkipped` 事件给界面弹提示 | 勘误 E10，开工拍板 |
| 每局第一张之前 | 不用决定（阶段 `start`，服务器自动翻） | 勘误 E10 |
| 信息可见性 | 帐篷宝石只给本人；本局携带量、神器件数公开；离开记录公开但不含宝石数；决定中的选择只公开「已决定/未决定」 | 待确认 #5、勘误 E8 E9，开工拍板 |
| 首页在线牌桌列表的分数 | 对局中不显示（会泄露帐篷），终局后才显示总分 | 隐藏信息 |
| 危险名字 | 火焰 fire、木乃伊 mummy、落石 rocks、蛇 snake、蜘蛛 spider | 待确认 #4，开工拍板 |
| 平局 | 总分 → 神器件数 → 并列获胜 | 待确认 #6 |
| 开房选项 | 「无神器」（法/德原版玩法）：整局不放神器。默认关，房主在等候房间里改 | 开工拍板 |
| 人数 | 3–8 人；一个真人加人机凑够 3 人就能开 | 规则书、全站人机约定 |
| 改主意 | 最后一个人决定之前，已经决定的人可以撤回或直接改选；最后一个人决定的那一刻立刻亮出 | 规则书 8.5 |
| 局与局之间 | 局末停 5 秒自动开下一局（不设「下一局」按钮），第 5 局后进入终局 | 规则书 8.2「房主或自动」选了自动，开工派活 |
| 观战看帐篷 | 房主打开「观战看帐篷」后，观战的人能看到所有人的帐篷；决定中的选择观战也看不到（观战的人能聊天，怕泄露） | 全站观战约定 + 本游戏取舍 |
| 托管 | 托管 = 人机代打（不是默认离开）；连续 2 次超时转托管；离线 3 秒后由人机代打；用原昵称回座 | 全站约定（规则书 8.4 的「超时默认离开」只用于真人超时的那一次） |

## 超时和节奏

| 步骤 | 时限 | 到点怎样 |
|---|---|---|
| 决定继续 / 离开（`decide`） | 30 秒，一张牌一个倒计时，别人决定、改选、撤回都**不会**重置 | 还没决定的人按「离开」处理（`TimedOut` 事件），然后亮出结算 |
| 新一局开始（`start`） | 1.5 秒 | 翻第一张 |
| 第一张是危险（`skip`） | 2.2 秒 | 翻下一张 |
| 亮出（`reveal`） | 没人离开 1.8 秒；有人离开 3 秒（宝石飞进帐篷的动画） | 翻下一张；神庙里没人了就结束这一局 |
| 局末（`roundEnd`） | 5 秒 | 开下一局；第 5 局后终局 |
| 终局 | 再来一局投票 60 秒（全站一样） | 没确认的人移出，其余回到等候房间 |

- 人机、托管、离线的人不显示倒计时，由人机代为决定（离线的人先等 3 秒）。
- 服务器环境变量：`TURN_MS` 统一改决定时限（测试用 300）；`PAUSE_SCALE` 把自动阶段的停顿整体乘一个倍数（测试用 0）；`ROUND_END_MS` 单独改局末停顿；`BOT_DELAY_SCALE` 人机停顿倍数。

## 本地运行

```bash
npm install
npm run dev          # 服务器 3019 + 网页 5192（改端口：SERVER_PORT=3119 WEB_PORT=5292 npm run dev）
npm test             # 全部测试
npm run test:game    # 只跑规则包
npm run typecheck
BASE_PATH=/incan/ npm run build
```

网页现在是**调试牌桌**（引擎阶段放的，正式界面由界面阶段做）：显示整个状态，每个合法行动一个按钮。

### 一个人怎么测（陪玩脚本）

```bash
npm run build:game
node scripts/test-bot.mjs host 4 3        # 建 4 人房，脚本自己坐 3 个座位，等你用浏览器加入凑满后自动开局
node scripts/test-bot.mjs join <房间码>    # 以一个机器人身份加入别人的房间
node scripts/test-bot.mjs solo 5           # 不等真人：5 个机器人自己打完一整局（自检用）
```

环境变量：`BOT_DELAY_MS`（每步思考时间，默认 800）、`BOT_IDLE=1`（只挂着不动，等超时）、`BOT_LEAVE=0.3`（每次选离开的概率）、`INCAN_NO_ARTIFACTS=1`（建房开「无神器」）、`SERVER_URL`。

## 目录

| 位置 | 内容 |
|---|---|
| `packages/game/src/types.ts` | 状态、命令、事件、阶段（对外接口） |
| `packages/game/src/engine.ts` | 规则引擎（纯函数）、隐藏信息 `redactGameForViewer`、计时 key |
| `packages/game/src/scenes.ts` | 预览局面工厂（对外接口） |
| `packages/game/src/cards.ts` | 牌的简写和中文名 |
| `packages/game/src/bot.ts` | 人机（现在是占位：随机继续 / 离开；人机阶段换成正式策略） |
| `packages/game/src/roomTypes.ts` | 房间、观战、socket 事件类型 |
| `packages/game/test/` | 规则书用例、补充用例、隐藏信息、随机对局；`test/acceptance/` 归规则核对，引擎不改 |
| `apps/server/` | Socket.IO 房间服务器、测试（人机、观战、挤登录、对局流程、抓包） |
| `apps/web/` | 网页（现在是调试牌桌）；`preview.html` + `src/preview.tsx` 是预览页，提交进仓库，由界面维护 |
| `scripts/test-bot.mjs` | 陪玩脚本；`scripts/spy.mjs` 抓包脚本 |

## 对外接口（`@incan/game`）

界面、人机、教程、验收都只通过这些用引擎。类型的逐字段说明见 `packages/game/src/types.ts`（注释就是文档）。测试里从 `packages/game/src/index.ts` 导入（`import { … } from "../../src/index.js"`）。

### 状态 `GameState`（关键字段）

| 字段 | 含义 | 谁能看 |
|---|---|---|
| `phase` | `start` 新一局开始 / `decide` 大家决定 / `reveal` 亮出并已结算 / `skip` 首张危险跳过 / `roundEnd` 局末 / `gameOver` | 公开 |
| `round` | 第几局（1–5） | 公开 |
| `players[i]` | `id` `name` `inTemple` `leftAfter`（第几张后离开）`carried`（本局携带）`tent`（帐篷宝石）`artifacts`（带出的神器 `{artifact, order, value, round}`）`decided` `choice` | `tent` 只给本人（别人是 `null`，终局或观战看帐篷时公开）；`choice` 决定中只给本人 |
| `path` | 本局翻出的牌（`{kind:"treasure",gems}` / `{kind:"hazard",hazard}` / `{kind:"artifact",artifact}`），局末时还在 | 公开 |
| `pathGems` | 路上余数宝石 | 公开 |
| `pathArtifacts` | 还躺在路上的神器编号（被拿走的从这里去掉，`path` 里那张还在） | 公开 |
| `deckCount` / `deckArtifacts` | 牌堆剩几张 / 其中几件神器 | 公开 |
| `removed` | 每种危险永久移出几张（0–2） | 公开 |
| `artifactsClaimed` / `artifactsLost` | 已带出几件（下一件的分值看它）/ 作废的神器编号 | 公开 |
| `turn` | 决定轮编号，每次进入 `decide` +1；命令里带上它 | 公开 |
| `departures` | 离开记录 `{round, after, players, artifacts}`（不含宝石数） | 公开 |
| `history` | 各局结果 `RoundResult`（`reason: allLeft/collapse`、`hazard`、`caught`、`lostGems`、`pathGemsDiscarded`、`artifactsDiscarded`、`cards`） | 公开 |
| `events` | 最近一步的事件（见下） | 公开（不含秘密） |
| `finalResult` | 终局：`scores`（按名次：`gems` `artifacts` `artifactPoints` `total` `rank`）、`winners` | 公开 |
| `version` | 每步 +1，界面看它变没变放动画 | 公开 |
| `deck` `seed` `rngState` `log` | 牌堆顺序、种子、随机数状态、动作序列 | 只在服务端（脱敏后 `deck` 是 `[]`，其余没有） |

塌方的局末（`roundEnd`）里，被困的人 `inTemple` 仍是 `true`（界面据此标「被困」），`carried` 已清零；下一局开始时所有人回到入口。

### 命令 `GameCommand`

| 命令 | 什么时候能发 | 说明 |
|---|---|---|
| `{ type: "decide", choice: "stay" \| "leave", turn? }` | `decide` 阶段、自己还在神庙里 | 已经决定过再发就是改选；最后一个人决定的那一步立刻亮出、结算，阶段变 `reveal` |
| `{ type: "undecide", turn? }` | `decide` 阶段、自己已经决定 | 撤回 |

`turn` 写 `state.turn`：和当前不一致（上一张牌的决定）就拒绝；不写就算当前这一轮。界面和人机都应该带上。校验不过时 `apply` 抛 `Error`，`message` 是给玩家看的中文。其他阶段（`start`、`skip`、`reveal`、`roundEnd`、`gameOver`）发任何命令都被拒绝。

### 事件 `GameEvent`（`state.events`）

| 事件 | 含义 / 界面拿它做什么 |
|---|---|
| `RoundStarted {round, deckCount, deckArtifacts, newArtifact}` | 新一局，洗牌；`newArtifact` 是新放进去的神器（无神器为 null） |
| `CardRevealed {card, index, inTemple, share, remainder, first}` | 翻出一张：宝物 `inTemple` 人各分 `share` 颗、余 `remainder` 留路上；危险 `first` 表示本局第一次出现 |
| `FirstHazardSkipped {hazard}` | 第一张是危险，直接翻下一张：弹提示 |
| `Decided {player}` / `Undecided {player}` | 有人决定 / 撤回（不含选了什么） |
| `TimedOut {players}` | 这些人超时，按离开处理 |
| `ChoicesRevealed {stay, leave}` | 同时亮出 |
| `PlayersLeft {players, carried, share, pathGemsBefore, pathGemsAfter, artifacts}` | 离开结算：每人存 `carried + share` 颗；`artifacts` 是单独离开拿走的神器 |
| `Collapse {hazard, caught, lostGems, removedNow}` | 塌方：被困的人每人丢 `lostGems` 颗；这种危险累计移出 `removedNow` 张 |
| `RoundEnded {result}` | 本局结束（`RoundResult`） |
| `GameEnded {result}` | 终局（`FinalResult`） |

一次 `apply` / `advance` 可能带多个事件，按发生顺序排：比如最后一个人决定 → `Decided, ChoicesRevealed, PlayersLeft`；超时 → `TimedOut, ChoicesRevealed, PlayersLeft`；翻到第二张同种危险 → `CardRevealed, Collapse, RoundEnded`；神庙里没人后的 `advance` → `RoundEnded`。

### 函数

| 函数 | 说明 |
|---|---|
| `createGame(players: {id,name}[], seed?, options?: {noArtifacts?}) → GameState` | 开局（3–8 人），阶段 `start`、第 1 局牌堆洗好 |
| `apply(state, playerId, command, rng?) → {state, events}` | 玩家命令（不改输入） |
| `advance(state, rng?) → {state, events}` | 自动阶段推进一步（`start`/`skip` 翻牌，`reveal` 翻牌或结束本局，`roundEnd` 开下一局或终局）；洗牌用传进来的 `rng`，不传就接着状态里的种子随机数。`decide`、`gameOver` 时抛错 |
| `timeoutTurn(state) → state` | 到点：`decide` 时没决定的人按离开处理；自动阶段同 `advance` |
| `applyCommand` / `advanceGame` | 服务器用：同上并记动作序列 |
| `legalActions(state, playerId) → GameCommand[]` | 没决定：`[继续, 离开]`；已决定：`[撤回, 改选]`；其他时候 `[]` |
| `pendingDeciders(state) → string[]` | 神庙里还没决定的人 |
| `autoCommand(state, playerId)` | 超时替他做的决定（离开） |
| `isAutoPhase(state)` / `timerKey(state)` / `timerMs(state)` | 是不是自动阶段 / 计时 key（只在换步骤时变）/ 这一步的时限毫秒 |
| `redactGameForViewer(state, viewerId, {seeAll?}) → GameState` | 某人的视角；`viewerId=""` 是观战；`seeAll` 是观战看帐篷 |
| `deckInfo(state) → {total, treasures, treasureGems, hazards, artifacts}` | 只用公开信息算牌堆还剩什么（脱敏后也能用） |
| `bustChance(state) → number` | 下一张就塌方的概率（公开信息） |
| `artifactValue(order)` / `splitGems(gems, people)` / `buildDeck(removed, artifacts)` / `noneRemoved()` | 小工具：第 n 件神器的分值、平分、某局的未洗牌堆（`artifacts` 给数字 k 表示 1..k） |
| `scoreLine(player)` / `computeFinalResult(state)` | 计分、终局结果 |
| `stackDeck(state, cards: Card[]) → state` | 把指定的牌挪到牌堆顶（教程剧本、测试） |
| `decideAll(state, choices?, fallback = "stay") → state` | 让神庙里还没决定的人全部决定（测试、教程） |
| `parseCard(spec)` / `cardLabel(card)` | 牌的简写（`11`、`"fire"`、`"A2"`、`"artifact"`）→ `Card`；牌的中文名 |
| `checkConservation(state) → string[]` | 配件守恒自检（服务端状态），空数组 = 没问题 |
| 常量 | `TREASURES` `HAZARD_TYPES` `HAZARD_NAMES` `HAZARD_COPIES` `ROUNDS` `ARTIFACT_COUNT` `MIN_PLAYERS` `MAX_PLAYERS` `DEFAULT_OPTIONS` `AUTO_PHASES` `CAPACITY_OPTIONS` |

### 预览局面工厂（`scenes.ts`）

```ts
import { buildScene, previewScene, previewRoom, previewSocketId, SCENE_LIST, SCENES } from "@incan/game";

// 1) 按名字：SCENE_LIST 里每个名字一个局面，SCENES[name].title 是中文说明
previewScene("collapse");   // 服务端完整状态

// 2) 按参数造任意精确局面：给这一局翻过的牌和谁在第几张后离开，携带、余数、帐篷、单人拿神器都按规则模拟
buildScene({
  players: 4,                         // 或名字数组；座位 id 是 p1..pN，默认名字 甲乙丙丁戊己庚辛
  round: 3,                           // 第几局
  removed: { snake: 1 },              // 这局开始时每种危险已移出几张（合计 ≤ 已打完的局数）
  claimsBefore: [{ player: "p2", artifact: 1, round: 1 }],  // 前几局带出的神器，按带出顺序
  lostBefore: [2],                    // 前几局作废的神器
  tentsBefore: { p1: 10, p2: 4 },     // 前几局攒的帐篷宝石
  path: [9, "A3", "snake", 2],        // 这局翻过的牌：数字=宝物，危险名，"A3"=第 3 件神器，"artifact"=牌堆里编号最小的神器
  leftAfter: { p1: 2 },               // p1 在第 2 张后（单独）离开 → 自动拿走 A3、存进帐篷
  choices: { p2: "leave" },           // decide 阶段已经决定的人（不能全员都决定）
  deckTop: [17, "fire"],              // 接下来要翻的牌
  phase: "decide",                    // 不给就自动判断（见 SceneSpec 注释）；可选 reveal / roundEnd / gameOver
  options: { noArtifacts: false },
  seed: 1,
});

// 3) 包成某人收到的房间快照（已按他的视角脱敏），预览页直接渲染牌桌
const room = previewRoom(previewScene("deciding"), {
  viewer: "p1",            // "" = 观战
  offline: ["p3"],         // 对手离线
  bots: ["p4"], auto: [],  // 人机座位、托管中
  turnRemainingMs: 3000,   // 倒计时（null = 不显示）
  spectatorsSeeAll: false,
  rematchAccepted: [],     // 终局后已经同意再来一局的座位
});
Object.defineProperty(socket, "id", { value: previewSocketId("p1") }); // 冒充自己
```

- 自动判断阶段：路径空 → `start`；只翻了一张而且是危险 → `skip`；最后一张是第二次出现的危险 → `roundEnd`（塌方，自动把那种危险的 `removed` 加 1）；最后一张后有人离开 → `reveal`；否则 → `decide`。
- `phase: "gameOver"` 且不给路径：直接造终局（`claimsBefore` 可以写到第 5 件、`tentsBefore` 就是最终帐篷），`finalResult` 按规则算好。
- 不可能的局面会抛错（危险移出超过已打完的局数、同一张牌用两次、第一张危险后有人离开、塌方后还翻牌、所有人都决定了还在 `decide`……）。
- 有名字的局面（`SCENE_LIST`）：`opening` 开局 · `treasure` 翻出宝物后决定 · `hazard` 翻出危险（第一次）后决定 · `artifact` 翻出神器后决定 · `deciding` 决定中（有人已决定）· `firstHazard` 首张危险跳过 · `reveal` 亮出（两人离开分余数）· `twoLeaveArtifact` 两人同走神器留路上 · `soloArtifact` 单人离开一次拿 2 件神器（跨过 10 分线）· `multiArtifact` 路上 2 件神器 · `collapse` 塌方 · `allLeft` 全员离开的局末 · `lastRound` 第 5 局 · `gameOver` 独胜 · `gameOverTieBreak` 同分比神器 · `gameOverShared` 并列获胜 · `noArtifacts` 无神器 · `eightPlayers` 8 人桌 · `timeout` 超时后亮出。对手离线、托管、倒计时快到、观战用 `previewRoom` 的参数造。
- 造出来的是服务端完整状态，可以接着 `apply` / `advance` 打下去。

### 服务器给网页的东西

- `room:updated` 的快照（`LobbyRoomSnapshot`）：`game` 已按收件人脱敏；`turnRemainingMs` 是这一步剩余毫秒：`decide` 阶段是这张牌的决定倒计时（还有在线真人没决定时才有，所有人都收到）；自动阶段是离自动推进还有多久。
- `room:create {name, capacity: 3–8, options?: {noArtifacts}}`，`room:settings {noArtifacts}`（房主在等候房间改），其余房间事件和全站一样（见 `roomTypes.ts`）。
- `game:command` 发上面的命令。
