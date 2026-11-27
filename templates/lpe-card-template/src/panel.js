// @ts-check
/// <reference path="../types/lpe-card.d.ts" />
(() => {
  const bridge = window.LPECard;
  const health = document.querySelector('#health');
  const resolve = document.querySelector('#resolve');
  const roll = document.querySelector('#roll');
  const status = document.querySelector('#status');
  const panel = document.querySelector('main');
  const rollButton = document.querySelector('#roll-button');
  const queueButton = document.querySelector('#queue-button');
  if (!health || !resolve || !roll || !status || !panel
      || !(rollButton instanceof HTMLButtonElement) || !(queueButton instanceof HTMLButtonElement)) return;
  if (!bridge) {
    status.textContent = 'Open this panel in the LPE renderer or local preview.';
    rollButton.disabled = queueButton.disabled = true;
    return;
  }

  const render = () => {
    health.textContent = (bridge.getState().health.overallHp ?? '—') + '%';
    resolve.textContent = String(bridge.getVar('stat_data.resolve', 50));
    roll.textContent = String(bridge.getVar('stat_data.lastRoll', '—'));
  };
  bridge.onStateChange(render);
  bridge.onVarsChange(render);
  render();

  // Measure content independently of the iframe viewport, including body padding.
  new ResizeObserver(() => bridge.resize(panel.getBoundingClientRect().height + 24)).observe(panel);

  rollButton.addEventListener('click', async () => {
    rollButton.disabled = true;
    try {
      // The same stored seed produces the same result after a reload or swipe.
      // LPECard.roll() uses Math.random and has no seed parameter.
      const value = bridge.getVar('stat_data.rollSeed', 1);
      const seed = typeof value === 'number' && Number.isInteger(value) ? value >>> 0 : 1;
      const next = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      await bridge.patchVars({ stat_data: { rollSeed: next, lastRoll: 1 + Math.floor(next / 4294967296 * 100) } });
      render();
      status.textContent = 'Roll recorded.';
    } catch (error) {
      status.textContent = String(error);
    } finally {
      rollButton.disabled = false;
    }
  });

  queueButton.addEventListener('click', async () => {
    try {
      const last = bridge.getVar('stat_data.lastRoll', 'unrolled');
      const result = await bridge.submitInput(`I scout the route ahead. (1d100: ${last})`);
      status.textContent = result.autoSend ? 'Action sent.' : 'Action queued for confirmation.';
    } catch (error) {
      status.textContent = String(error);
    }
  });
})();
