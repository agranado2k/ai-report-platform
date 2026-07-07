/**
 * Hand-picked fragments from the fixture (verified against the actual file,
 * not guessed from the task description's approximate line numbers). Used by
 * Test A's fidelity scorecard.
 */

export const fragments: Record<string, string> = {
  chipCluster: `<div class="chips">
            <span class="chip chip-cto">CTO</span>
            <span class="chip chip-staff">Staff Engineer</span>
            <span class="chip chip-pm">Product Manager / PM-Eng</span>
          </div>`,

  card: `<div class="card">
          <div class="card-eyebrow">Your baseline (sourced)</div>
          <ul class="baseline">
            <li><span class="k">Role:</span> Founder &amp; CTO, House Numbers · London</li>
            <li><span class="k">Prior:</span> Snyk, Gousto, Maestrano, ex-CTO @ Pluga, co-founder Smartcoin</li>
            <li><span class="k">Education:</span> UFF (B.Sc. CS), UFRJ M.Sc. Computer Engineering (2007–2010)</li>
            <li><span class="k">Stack tells:</span> TDD, FP (Clojure), Ruby, security-mind, distributed systems</li>
            <li><span class="k">Side:</span> ai-report-platform — LLM/MCP-native SaaS</li>
            <li><span class="k">Languages:</span> PT · EN · IT · ES</li>
          </ul>
        </div>`,

  checklist: `<ul class="checklist">
            <li>Chip Huyen · <em>AI Engineering</em></li>
            <li>Will Larson · <em>Crafting Engineering Strategy</em> + AI Companion</li>
            <li>Simon Willison's "Lethal Trifecta" + last 90 days of his newsletter</li>
          </ul>`,

  detailsSummary: `<details class="resgroup card" open>
        <summary>🎓 Courses — non-university (paid &amp; free)</summary>
        <div class="resrow"><div><div class="rt">AI Evals for Engineers &amp; PMs ⭐</div><div class="rmeta">Hamel Husain &amp; Shreya Shankar · Maven · <span class="ref">maven.com/parlance-labs/evals</span></div><div class="rd">77 lessons, 10+ live office hours, 4 coding assignments. Curriculum: error analysis, synthetic data, LLM-as-judge, RAG debugging, eval-in-CI, agentic + multi-modal evals, safety guardrails. <strong>Highest-ROI paid course for you</strong> — your TDD muscle redeployed.</div></div><div class="rtags"><span class="chip chip-cto">CTO</span><span class="chip chip-staff">Staff</span><span class="chip chip-pm">PM</span><span class="chip chip-now">Now</span></div></div>
        <div class="resrow"><div><div class="rt">Neural Networks: Zero to Hero</div><div class="rmeta">Andrej Karpathy · free YouTube · <span class="ref">karpathy.ai/zero-to-hero.html</span></div><div class="rd">Build LLMs from scratch, end-to-end. ~30 hours. Stop after GPT-2 reproduction — diminishing returns past that for a CTO.</div></div><div class="rtags"><span class="chip chip-cto">CTO</span><span class="chip chip-staff">Staff</span><span class="chip chip-now">Now</span></div></div>
      </details>`,

  table: `<div class="tablewrap">
        <table>
          <thead>
            <tr><th>Dimension</th><th>CTO</th><th>Staff Engineer</th><th>PM / PM-Engineer</th></tr>
          </thead>
          <tbody>
            <tr><td>Primary unit of work</td><td>Decisions &amp; bets</td><td>Systems &amp; patterns</td><td>Outcomes &amp; eval lift</td></tr>
            <tr><td>Failure mode they fear most</td><td>Wrong capital allocation</td><td>Silent regressions in probabilistic behavior</td><td>Shipping a feature with no eval</td></tr>
            <tr><td>What "good" looks like in 2026</td><td>Quarterly model/vendor reviews, audited governance, low-friction hiring</td><td>Production agent w/ tool contracts, trace-level obs, eval-in-CI, &lt;1% drift</td><td>Eval set live, error analysis weekly, calibrated confidence in UX</td></tr>
            <tr><td>Top 2026 skill gap</td><td>Build-vs-buy in agentic stack; EU AI Act</td><td>Agent observability; cost-per-successful-outcome economics</td><td>Eval design; LLM-as-judge; AI UX patterns</td></tr>
            <tr><td>"Read this first"</td><td>Larson · <em>Crafting Engineering Strategy</em></td><td>Huyen · <em>AI Engineering</em></td><td>Hamel &amp; Shreya · evals course</td></tr>
          </tbody>
        </table>
      </div>`,

  resrow: `<div class="resrow"><div><div class="rt">AI Engineering: Building Applications with Foundation Models</div><div class="rmeta">Chip Huyen · O'Reilly · 2025 · companion repo <span class="ref">github.com/chiphuyen/aie-book</span></div><div class="rd">Single best inventory of the modern stack: RAG, agents, evals, fine-tuning, inference optimization. Already most-read on O'Reilly. Read cover-to-cover; you'll skim only chapter 1.</div></div><div class="rtags"><span class="chip chip-cto">CTO</span><span class="chip chip-staff">Staff</span><span class="chip chip-now">Now</span></div></div>`,

  secHeading: `<h2 class="sec"><span class="secnum">1</span>Executive summary</h2>`,
}
