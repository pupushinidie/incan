import { useEffect, useState } from "react";

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，不照搬原版规则书。 */
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
              <h3>目标</h3>
              <p>
                打 <b>5 局</b>。每局大家一起钻进神庙翻牌分宝石，带回营地的宝石存进自己的帐篷，以后再也不会丢。
                最后帐篷里的宝石（1 颗 1 分）加上神器分，总分最高的人赢。
              </p>
            </div>
            <div className="game-rules-block">
              <h3>翻牌</h3>
              <ul>
                <li><b>宝物</b>：还在神庙里的人平分，除不尽的余数留在路上。例：4 个人翻出 11 → 每人 2 颗，路上留 3 颗。</li>
                <li><b>危险</b>（火焰、木乃伊、落石、蛇、蜘蛛）：这一局第一次出现没事；<b>同一种第二次出现就塌方</b>，还在里面的人这一局带着的宝石全丢。塌方的那张危险永久拿走，之后几局这种危险更少。</li>
                <li><b>神器</b>：先放在路上。没翻出来的神器会留到下一局，所以一条路上可能有好几件。</li>
                <li>每局第一张翻牌前、以及第一张就是危险时，不用做决定，直接往下翻。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>继续还是离开</h3>
              <ul>
                <li>每翻一张，神庙里的人<b>同时</b>选「继续挖」或「离开」。大家都选好了一起亮出；最后一个人选之前都能改。</li>
                <li>离开的人平分路上的余数（还除不尽的留在路上），连同这一局的宝石一起存进帐篷，这一局不能再回来。</li>
                <li><b>只有一个人离开</b>时，他把路上所有神器都带走；两个人以上一起走，谁也拿不到。</li>
                <li>所有人都离开或者塌方，这一局结束。路上没人分的宝石和没人拿的神器作废。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>计分和平局</h3>
              <ul>
                <li>神器按整局带出神庙的先后算分：第 1、2、3 件各 5 分，第 4、5 件各 10 分（作废的不算件数）。</li>
                <li>帐篷里的宝石只有自己看得到，别人带出了几件神器、这一局手上有多少宝石是公开的。</li>
                <li>同分比神器件数，再一样就并列获胜。</li>
                <li>开房选项「无神器」：整局不放神器，只比宝石。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>时间和托管</h3>
              <p>
                每张牌有 30 秒做决定，超时按「离开」处理（落袋为安）。连续超时 2 次转托管（人机替你选），
                掉线时也由人机代选，回来就交还给你。
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
