/**
 * 牌桌的几块：情况条（危险、牌堆、余数、神器、塌方概率）、神庙路径、营地（每人一张帐篷卡）。
 * 尺寸都由 layout.ts 给的倍数决定，像素图只按整数倍显示。
 */
import type { CSSProperties, ReactNode } from "react";
import {
  bustChance,
  deckInfo,
  HAZARD_NAMES,
  HAZARD_TYPES,
  type Card,
  type GameState,
  type LobbyMember,
  type Player,
} from "@incan/game";
import { art, CARD_H, CARD_W, cardArt, seatColor, SEAT_HEX, type IconName } from "./art.js";
import { partyWidth, type Layout } from "./layout.js";
import { artifactName, artifactValueAt } from "./words.js";

/** 像素图：按原图尺寸 × 倍数显示。 */
export function Px({ src, w, h, s, className = "", alt = "", style, title }: {
  src: string;
  w: number;
  h: number;
  s: number;
  className?: string;
  alt?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return <img className={`ig-px ${className}`} src={src} width={w * s} height={h * s} alt={alt} style={style} title={title} draggable={false} />;
}

export function Icon({ name, s = 2, className = "", title }: { name: IconName; s?: number; className?: string; title?: string }) {
  return <Px src={art.icon(name)} w={16} h={16} s={s} className={`ig-icon ${className}`} {...(title ? { title } : {})} />;
}

/** 塌方概率的危险程度（颜色用）。 */
export function bustTone(chance: number): "safe" | "warn" | "danger" {
  if (chance >= 0.2) return "danger";
  if (chance >= 0.08) return "warn";
  return "safe";
}

export const percent = (chance: number) => `${Math.round(chance * 100)}%`;

// ---------- 情况条 ----------

export function InfoBar({ game, layout, refs }: { game: GameState; layout: Layout; refs: { gems: (el: HTMLElement | null) => void } }) {
  const info = deckInfo(game);
  const live = game.phase !== "gameOver";
  const chance = bustChance(game);
  const seen = new Set(game.path.flatMap((card) => (card.kind === "hazard" ? [card.hazard] : [])));
  const collapsed = game.phase === "roundEnd" && game.history.at(-1)?.round === game.round ? game.history.at(-1)!.hazard : null;
  const nextValue = artifactValueAt(game.artifactsClaimed + 1);
  const iconS = layout.mobile ? 2 : 2;
  return (
    <section className="ig-info" data-tutorial="info-bar">
      <div className="ig-hazards" data-tutorial="hazards" aria-label="危险">
        {HAZARD_TYPES.map((hazard) => {
          const appeared = seen.has(hazard);
          const removed = game.removed[hazard];
          const left = info.hazards[hazard];
          const state = collapsed === hazard ? "boom" : appeared ? (left > 0 ? "hot" : "spent") : "";
          const tip = `${HAZARD_NAMES[hazard]}：${appeared ? `这局已经出过，牌堆里还有 ${left} 张，再翻到就塌方` : `这局还没出过，牌堆里 ${left} 张`}${removed ? `；整局已经永久移出 ${removed} 张` : ""}`;
          return (
            <span key={hazard} className={`ig-hazard ${state}`} title={tip} aria-label={tip}>
              <Px src={art.hazardIcon(hazard)} w={16} h={16} s={iconS} />
              <small>{appeared ? `剩${left}` : HAZARD_NAMES[hazard]}</small>
              {removed > 0 && <em className="ig-removed">−{removed}</em>}
            </span>
          );
        })}
      </div>
      <div className="ig-stats">
        <span className="ig-stat" data-tutorial="deck" title={`牌堆还剩 ${game.deckCount} 张：宝物 ${info.treasures.length} 张（共 ${info.treasureGems} 颗）、危险 ${HAZARD_TYPES.reduce((sum, hazard) => sum + info.hazards[hazard], 0)} 张${game.config.noArtifacts ? "" : `、神器 ${game.deckArtifacts} 件`}`}>
          <Icon name="deck" s={layout.mobile ? 1 : 2} />
          <span><small>牌堆</small><b>{game.deckCount}</b></span>
        </span>
        <span className="ig-stat" data-tutorial="path-gems" ref={refs.gems} title="路上的余数宝石：平分剩下的，等有人回营地时在离开的人之间平分；一局结束时没人拿的作废">
          <Icon name="gem" s={layout.mobile ? 1 : 2} />
          <span><small>路上余数</small><b>{live ? game.pathGems : 0}</b></span>
        </span>
        {game.config.noArtifacts ? (
          <span className="ig-stat ig-noart" title="开了「无神器」：整局不放神器">无神器</span>
        ) : (
          <span className="ig-stat ig-artifacts" data-tutorial="artifacts" title={`神器：路上 ${game.pathArtifacts.length} 件（只有一个人单独回营地时能全部拿走），牌堆里还有 ${game.deckArtifacts} 件（没翻出来的留到下一局）。整局已经带出 ${game.artifactsClaimed} 件，下一件值 ${nextValue} 分（第 1–3 件 5 分，第 4、5 件 10 分）`}>
            <Icon name="artifact" s={layout.mobile ? 1 : 2} />
            <span><small>神器 路上/牌堆</small><b>{game.pathArtifacts.length}<i>/</i>{game.deckArtifacts}</b></span>
            {game.artifactsClaimed < 5 && (
              <span className="ig-next-art">
                <Px src={art.badge(nextValue)} w={20} h={20} s={layout.mobile ? 1 : 2} />
                <small>下一件<br />{nextValue} 分</small>
              </span>
            )}
          </span>
        )}
        <span className={`ig-stat ig-bust ${bustTone(chance)}`} data-tutorial="bust-chance" title="下一张翻出来就塌方的机会：这局已经出过的危险，牌堆里还剩几张 ÷ 牌堆张数（都是公开信息）">
          <span><small>下一张塌方</small><b>{live && game.phase !== "roundEnd" && game.phase !== "start" ? percent(chance) : "—"}</b></span>
        </span>
      </div>
    </section>
  );
}

// ---------- 神庙路径 ----------

export interface PathFx {
  /** 刚翻出的牌（播翻牌）。 */
  fresh: number | null;
  /** 刚翻出宝物时浮在牌上的字。 */
  freshLabel: string | null;
  /** 原地晃一下的牌（两人一起走、神器留下）。 */
  wobble: Set<number>;
  /** 塌方：整条路抖、落石。 */
  collapse: boolean;
  /** 被拿走的神器：牌的位置 → 谁拿走的。 */
  takenBy: Map<number, string>;
}

/** 路径上牌的摆放：一行 cols 张，超过 rows 行时后面的牌叠起来（每行张数平均分配）。 */
function placeCards(count: number, layout: Layout, width: number) {
  const cw = CARD_W * layout.s;
  const ch = CARD_H * layout.s;
  const rowsNeeded = Math.max(1, Math.ceil(count / layout.cols));
  const rows = Math.min(rowsNeeded, layout.rows);
  const perRow = rows < rowsNeeded ? Math.ceil(count / rows) : layout.cols;
  const step = perRow <= 1 ? cw + layout.gap : Math.min(cw + layout.gap, (width - cw) / (perRow - 1));
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    return { left: Math.floor(col * step), top: row * (ch + layout.gap), overlap: step < cw + layout.gap };
  });
}

export function PathView({ game, layout, width, players, fx, cardRef, slotRef, explorersIn, overlay }: {
  game: GameState;
  layout: Layout;
  width: number;
  players: Player[];
  fx: PathFx;
  cardRef: (index: number) => (el: HTMLElement | null) => void;
  slotRef: (el: HTMLElement | null) => void;
  explorersIn: Player[];
  /** 叠在路径下半部分的东西（局末小结）。 */
  overlay?: ReactNode;
}) {
  const s = layout.s;
  const cw = CARD_W * s;
  const ch = CARD_H * s;
  const ended = game.phase === "roundEnd" || game.phase === "gameOver";
  const last = game.history.at(-1);
  const collapseHazard = game.phase === "roundEnd" && last?.round === game.round && last.reason === "collapse" ? last.hazard : null;
  const showSlot = !ended;
  const party = layout.party && showSlot && explorersIn.length > 0;
  const partyCols = party ? Math.ceil(partyWidth(explorersIn.length, s) / (cw + layout.gap)) : 0;
  const total = game.path.length + (showSlot ? 1 : 0) + partyCols;
  const spots = placeCards(total, layout, width);
  // 路上神器按带出顺序标分值：第一件 = 已带出件数 + 1
  let artifactOrder = game.artifactsClaimed;
  const artifactLabels = new Map<number, number>();
  game.path.forEach((card, index) => {
    if (card.kind === "artifact" && game.pathArtifacts.includes(card.artifact)) {
      artifactOrder += 1;
      artifactLabels.set(index, artifactValueAt(artifactOrder));
    }
  });
  const height = spots.length ? Math.max(...spots.map((spot) => spot.top)) + ch : ch;
  return (
    <section
      className={["ig-path", fx.collapse ? "collapse" : "", ended ? "ended" : ""].join(" ")}
      data-tutorial="path"
      style={{ height: layout.pathH, "--cw": `${cw}px`, "--ch": `${ch}px`, "--s": s } as CSSProperties}
    >
      {!layout.mobile && (
        <>
          <span className="ig-torch" style={{ top: 8, animationDelay: "0ms" }} aria-hidden="true" />
          <span className="ig-torch" style={{ bottom: 8, animationDelay: "-360ms" }} aria-hidden="true" />
        </>
      )}
      <div className="ig-path-cards" style={{ width, height }}>
        {game.path.map((card, index) => {
          const spot = spots[index]!;
          const taken = card.kind === "artifact" && !game.pathArtifacts.includes(card.artifact);
          const lost = card.kind === "artifact" && taken && game.artifactsLost.includes(card.artifact) && !fx.takenBy.has(index);
          const crack = collapseHazard !== null && card.kind === "hazard" && card.hazard === collapseHazard;
          const value = artifactLabels.get(index);
          return (
            <div
              key={`${game.round}-${index}`}
              ref={cardRef(index)}
              className={[
                "ig-card",
                `ig-card-${card.kind}`,
                fx.fresh === index ? "fresh" : "",
                fx.wobble.has(index) ? "wobble" : "",
                taken ? "taken" : "",
                crack ? "cracked" : "",
              ].join(" ")}
              style={{ left: spot.left, top: spot.top, zIndex: index + 1 }}
              title={cardTitle(card, taken, lost, fx.takenBy.get(index), value)}
              data-tutorial={index === game.path.length - 1 ? "last-card" : card.kind === "artifact" && value ? "path-artifact" : undefined}
              data-card={index}
              data-kind={card.kind}
            >
              <Px src={cardArt(card)} w={CARD_W} h={CARD_H} s={s} alt={cardTitle(card, taken, lost, undefined, value)} />
              {crack && <span className="ig-crack" />}
              {value !== undefined && !ended && (
                <span className="ig-art-value" title={`单独回营地的人带走它，算整局第 ${game.artifactsClaimed + 1} 件起，值 ${value} 分`}>
                  <Px src={art.badge(value)} w={20} h={20} s={s >= 3 ? 2 : 1} />
                </span>
              )}
              {taken && <span className="ig-card-note">{lost ? "作废" : s === 1 || !fx.takenBy.get(index) ? "已拿走" : `${fx.takenBy.get(index)}拿走`}</span>}
              {fx.fresh === index && fx.freshLabel && (
                <span className={`ig-card-float ${spot.left < cw ? "at-left" : spot.left + 2 * cw > width ? "at-right" : ""}`}>{fx.freshLabel}</span>
              )}
            </div>
          );
        })}
        {showSlot && (
          <div
            ref={slotRef}
            className="ig-card ig-slot"
            style={{ left: spots[game.path.length]!.left, top: spots[game.path.length]!.top, zIndex: 0 }}
            data-tutorial="next-card"
            title={`下一张：牌堆还剩 ${game.deckCount} 张`}
          >
            <Px src={art.slot} w={CARD_W} h={CARD_H} s={s} alt="下一张" />
          </div>
        )}
        {party && (
          <div
            className="ig-party"
            style={{ left: spots[game.path.length + 1]!.left, top: spots[game.path.length + 1]!.top + ch - 24 * s, width: partyWidth(explorersIn.length, s) }}
            title={`还在神庙里：${explorersIn.map((player) => player.name).join("、")}`}
            data-tutorial="party"
          >
            {explorersIn.map((player, index) => (
              <Px
                key={player.id}
                src={art.explorer(seatColor(players.indexOf(player)))}
                w={16}
                h={24}
                s={s}
                className="ig-explorer"
                style={{ left: index * 8 * s, animationDelay: `${(index % 4) * 120}ms` }}
              />
            ))}
          </div>
        )}
        {game.path.length === 0 && game.phase === "start" && <p className="ig-path-empty">第 {game.round} 局：大家走进神庙……</p>}
      </div>
      {overlay}
      {fx.collapse && (
        <div className="ig-collapse-fx" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index} style={{ left: `${8 + index * 20}%`, top: `${index % 2 ? 40 : 10}%`, animationDelay: `${index * 100}ms`, "--fs": s } as CSSProperties} />
          ))}
        </div>
      )}
    </section>
  );
}

function cardTitle(card: Card, taken: boolean, lost: boolean, by: string | undefined, value: number | undefined): string {
  if (card.kind === "treasure") return `宝物 ${card.gems} 颗`;
  if (card.kind === "hazard") return `危险：${HAZARD_NAMES[card.hazard]}`;
  const name = `神器「${artifactName(card.artifact)}」`;
  if (taken) return `${name}：${by ? `${by}拿走了` : lost ? "作废了" : "已被拿走"}`;
  return `${name}：只有一个人单独回营地时能拿走${value ? `，值 ${value} 分` : ""}`;
}

// ---------- 营地 ----------

export interface TentFx {
  /** 帐篷上飘的字（+2、+7 进帐篷）。 */
  floats: Map<string, { text: string; key: number; tone?: string }>;
  /** 高亮（单独离开拿神器、刚回营地）。 */
  glow: Map<string, string>;
}

export function Camp({ game, layout, members, selfId, fx, tentRef, spectating }: {
  game: GameState;
  layout: Layout;
  members: (playerId: string) => LobbyMember | undefined;
  selfId: string;
  fx: TentFx;
  tentRef: (playerId: string) => (el: HTMLElement | null) => void;
  spectating: boolean;
}) {
  return (
    <section className={`ig-camp ${layout.bigNames ? "big" : ""}`} data-tutorial="camp" style={{ "--camp-cols": layout.campCols, "--ts": layout.ts } as CSSProperties}>
      {game.players.map((player, index) => (
        <TentCard
          key={player.id}
          game={game}
          player={player}
          index={index}
          layout={layout}
          member={members(player.id)}
          self={player.id === selfId}
          spectating={spectating}
          float={fx.floats.get(player.id)}
          glow={fx.glow.get(player.id)}
          tentRef={tentRef(player.id)}
        />
      ))}
    </section>
  );
}

function TentCard({ game, player, index, layout, member, self, spectating, float, glow, tentRef }: {
  game: GameState;
  player: Player;
  index: number;
  layout: Layout;
  member: LobbyMember | undefined;
  self: boolean;
  spectating: boolean;
  float: { text: string; key: number; tone?: string } | undefined;
  glow: string | undefined;
  tentRef: (el: HTMLElement | null) => void;
}) {
  const color = seatColor(index);
  const ts = layout.ts;
  const last = game.history.at(-1);
  const roundOver = game.phase === "roundEnd" && last?.round === game.round;
  const trapped = roundOver && last!.caught.includes(player.id);
  const over = game.phase === "gameOver";
  const inTemple = player.inTemple && !over && !trapped;
  const home = !player.inTemple || over;
  const deciding = game.phase === "decide" && inTemple;
  const pending = deciding && !player.decided;
  const offline = member ? !member.connected : false;
  const status = trapped ? "被困" : over ? "" : player.inTemple ? (game.phase === "start" ? "进神庙" : "神庙里") : `第${player.leftAfter}张`;
  const choiceS = ts >= 3 ? 2 : 1;
  let choice: ReactNode = null;
  if (game.phase === "decide" && inTemple) {
    choice = player.decided
      ? <Px key="d" src={art.choiceCard(player.choice ?? "back")} w={24} h={32} s={choiceS} className="ig-choice-card" title={player.choice ? `你选了${player.choice === "stay" ? "继续挖" : "回营地"}（别人看不到）` : "已经决定了（亮出前看不到选了什么）"} />
      : <Px key="w" src={art.icon("wait")} w={16} h={16} s={ts >= 2 ? 2 : 1} className="ig-choice-wait" title="还在想" />;
  } else if (game.phase === "reveal" && player.choice && (player.inTemple || player.leftAfter === game.path.length)) {
    choice = <Px key={`r${game.turn}`} src={art.choiceCard(player.choice)} w={24} h={32} s={choiceS} className="ig-choice-card flip" title={player.choice === "stay" ? "继续挖" : "回营地"} />;
  }
  const lost = trapped ? last!.lostGems : 0;
  return (
    <div
      ref={tentRef}
      className={[
        "ig-tent",
        self ? "self" : "",
        inTemple ? "in" : "out",
        pending ? "pending" : "",
        trapped ? "trapped" : "",
        glow ?? "",
      ].join(" ")}
      style={{ "--seat": SEAT_HEX[color] } as CSSProperties}
      data-tutorial={self ? "my-tent" : undefined}
      data-player={player.id}
    >
      <div className="ig-tent-top">
        <Px src={art.tent(color, home)} w={32} h={24} s={ts} className="ig-tent-img" alt={home ? "已回营地" : "还在神庙里"} />
        {trapped && <Icon name="skull" s={ts >= 2 ? 2 : 1} className="ig-skull" title={`塌方被困，这局的 ${lost} 颗丢了`} />}
        <span className="ig-choice" data-tutorial={self ? "my-choice" : undefined}>{choice}</span>
      </div>
      <div className="ig-tent-name">
        <Px src={art.mark(color)} w={10} h={10} s={layout.bigNames ? 2 : 1} className="ig-mark" />
        <strong title={player.name}>{player.name}</strong>
        {self && !spectating && <small className="ig-tag you">你</small>}
        {member?.bot && <small className="ig-tag bot">人机</small>}
        {!member?.bot && member?.auto && <small className="ig-tag auto" title="托管中：人机在替他选">托管</small>}
        {!member?.bot && offline && <small className="ig-tag off" title="掉线了，人机在替他选；回来就交还">{layout.bigNames ? "离线·代打" : "离线"}</small>}
      </div>
      <div className="ig-tent-stats">
        {trapped ? (
          <span className="ig-lost" title={`塌方：这局的 ${lost} 颗全丢了`}><Icon name="gem" s={1} /><s>{lost}</s><small>丢了</small></span>
        ) : inTemple ? (
          <span className="ig-carry" title={`这局手上 ${player.carried} 颗（公开；还在神庙里的人手上一样多）`}><Icon name="gem" s={1} /><b>{player.carried}</b><small>手上</small></span>
        ) : (
          <span className="ig-home-note" title={status}><Icon name="camp" s={1} /><small>{over ? "营地" : status}</small></span>
        )}
        <span className="ig-arts" title={player.artifacts.length ? `带出的神器：${player.artifacts.map((claim) => `「${artifactName(claim.artifact)}」第 ${claim.order} 件 ${claim.value} 分`).join("、")}` : "还没带出神器"}>
          {player.artifacts.length > 0 && layout.bigNames ? (
            player.artifacts.map((claim) => <Px key={claim.order} src={art.badge(claim.value)} w={20} h={20} s={1} />)
          ) : (
            <><Icon name="artifact" s={1} /><b>{player.artifacts.length}</b></>
          )}
        </span>
        {spectating && player.tent !== null && <span className="ig-spy-tent" title="帐篷里的宝石（房主开了观战看帐篷）"><Icon name="tent" s={1} /><b>{player.tent}</b></span>}
      </div>
      {float && <span key={float.key} className={`ig-float ${float.tone ?? ""}`}>{float.text}</span>}
    </div>
  );
}
