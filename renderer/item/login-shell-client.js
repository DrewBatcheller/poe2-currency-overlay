document.getElementById('back').onclick = () => window.loginShell.nav('back');
document.getElementById('fwd').onclick = () => window.loginShell.nav('forward');
document.getElementById('home').onclick = () => window.loginShell.nav('home');
window.loginShell.onState(({ url, canBack, canFwd }) => {
  document.getElementById('url').textContent = url || '';
  document.getElementById('back').disabled = !canBack;
  document.getElementById('fwd').disabled = !canFwd;
});
