import { useEffect, useState } from "react";
import type { Card } from "@incan/game";
import { art, CARD_H, CARD_W, cardArt } from "./art.js";

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，配游戏里的图，短。 */
function Fig({ card, label }: { card: Card; label: string }) {
  return (
    <figure>
      <img className="ig-px" src={cardArt(card)} width={CARD_W} height={CARD_H} alt="" />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function GameRules({ className = "quiet-button" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className={`${className} ig-rules-button`} type="button" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="gm-panel ig-rules" role="dialog" aria-modal="true" aria-labelledby="ig-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="ig-rules-title">印加宝藏怎么玩</h2>
            <div className="game-rules-block">
              <h3><img className="ig-px" src={art.icon("temple")} width={32} height={32} alt="" />打 5 局，比谁带回的多</h3>
              <p>
                每局大家一起进神庙，一张张翻牌。带回营地的宝石存进自己的<b>帐篷</b>，存进去就不会丢。
                5 局后帐篷里的宝石（1 颗 1 分）加神器分，总分最高的人赢。
              </p>
            </div>
            <div className="game-rules-block">
              <h3><img className="ig-px" src={art.icon("deck")} width={32} height={32} alt="" />翻到什么</h3>
              <div className="ig-rules-row">
                <Fig card={{ kind: "treasure", gems: 11 }} label="宝物" />
                <Fig card={{ kind: "hazard", hazard: "fire" }} label="危险" />
                <Fig card={{ kind: "artifact", artifact: 1 }} label="神器" />
              </div>
              <ul>
                <li><b>宝物</b>：还在神庙里的人平分，分不完的余数留在路上。4 个人翻到 11：每人 2 颗，路上留 3 颗。</li>
                <li><b>危险</b>（火焰、木乃伊、落石、蛇、蜘蛛，各 3 张）：这局第一次出现没事；<b>同一种第二次出现就塌方</b>，还在里面的人这局手上的宝石全丢。塌方的那张永久拿走，以后这种危险更少。</li>
                <li><b>神器</b>：放在路上。没翻出来的会留到下一局，所以路上可能同时有好几件。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3><img className="ig-px" src={art.choiceIcon("stay")} width={32} height={32} alt="" />继续挖，还是回营地</h3>
              <ul>
                <li>每翻一张，神庙里的人<b>同时</b>选。大家都选好了一起亮出，最后一个人选之前都能改。</li>
                <li>回营地的人平分路上的余数（还分不完的继续留在路上），连同这局手上的宝石一起存进帐篷，这局不能再回来。</li>
                <li><b>只有一个人回营地</b>时，他把路上所有神器都带走；两个人以上一起走，谁也拿不到。</li>
                <li>大家都回营地、或者塌方，这局结束：路上没人分的宝石和没人拿的神器作废。</li>
                <li>每局第一张翻牌前、第一张就是危险时，不用选，直接往下翻。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3><img className="ig-px" src={art.badge(10)} width={40} height={40} alt="" />神器、平局、看得到什么</h3>
              <ul>
                <li>神器按整局带出神庙的先后算分：第 1–3 件各 5 分，第 4、5 件各 10 分（作废的不算件数）。</li>
                <li>帐篷里的宝石只有自己看得到；每个人这局手上有几颗、带出了几件神器是公开的。</li>
                <li>总分一样比神器件数，再一样就并列获胜。开房选项「无神器」：整局不放神器，只比宝石。</li>
                <li>牌桌上方会算好「下一张塌方」的机会，只用大家都看得到的信息。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3><img className="ig-px" src={art.icon("wait")} width={32} height={32} alt="" />时间和托管</h3>
              <p>
                每张牌 30 秒，超时按「回营地」处理（落袋为安）。连续超时 2 次转托管，人机替你选；掉线时也由人机代选，回来就交还。
                键盘：1 继续挖，2 回营地，Esc 撤回。
              </p>
            </div>
            <div className="gm-panel-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
