(function () {
  try {
    var stored = localStorage.getItem('theme-preference');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  try {
    var redirect = sessionStorage.getItem('redirect');
    if (redirect) {
      sessionStorage.removeItem('redirect');
      window.history.replaceState(null, '', redirect);
    }
  } catch (error) {
    // Ignore storage failures and keep the current location.
  }
})();
