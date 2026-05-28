export const THEME_STORAGE_KEY = "bilan-theme";

// Runs synchronously in <head> before the first paint to avoid a light-theme
// flash on reload when the user previously chose dark.
export const themeBootstrapScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;
