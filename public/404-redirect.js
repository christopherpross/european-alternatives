(function () {
  try {
    sessionStorage.setItem('redirect', location.pathname + location.search + location.hash);
  } catch (error) {
    // Ignore storage failures and fall back to a plain redirect.
  }

  location.replace('/');
})();
