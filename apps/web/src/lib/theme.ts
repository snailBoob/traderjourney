export type Theme = "dark" | "light" | "system";
export const THEME_KEY = "journal-theme-v1";

export const themePreference = (value: string | null): Theme =>
  value === "light" || value === "dark" || value === "system" ? value : "system";

export const THEME_INIT_SCRIPT = `(()=>{let saved=null;try{saved=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch{}let theme=saved==="dark"||saved==="light"||saved==="system"?saved:"system";let dark=theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark)})();`;
