// peek-client.js - renders listing-card HTML pushed from main into the peek window.
window.peekApi.onContent((payload) => {
  const { html, alpha } = typeof payload === 'string' ? { html: payload, alpha: 0.97 } : payload;
  const card = document.getElementById('card');
  card.innerHTML = html;
  // match the overlay's background-transparency setting
  card.style.background = `rgba(16, 15, 13, ${alpha})`;
  // report content height so main can size the window to fit
  requestAnimationFrame(() => {
    window.peekApi.reportHeight(card.scrollHeight + 4);
  });
});
