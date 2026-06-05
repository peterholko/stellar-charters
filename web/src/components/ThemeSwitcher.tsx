import { store, useApp, type ThemeId } from "../match/store";
import { Icon } from "../ui/icons";

const THEMES: { id: ThemeId; label: string; swatch: string[] }[] = [
  { id: "terminal", label: "Command Terminal", swatch: ["#07080c", "#ffb000", "#56d4ff"] },
  { id: "used-future", label: "Used Future", swatch: ["#12100c", "#e07a3a", "#c7a86b"] },
  { id: "clean", label: "Clean Sci-Fi", swatch: ["#0b1220", "#4f8dff", "#38d3c9"] },
];

export function ThemeSwitcher() {
  const { theme } = useApp();
  return (
    <div className="theme-switch" title="Visual theme">
      <Icon name="palette" size={15} />
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`theme-switch__opt ${theme === t.id ? "is-active" : ""}`}
          title={t.label}
          aria-label={t.label}
          onClick={() => store.setTheme(t.id)}
        >
          {t.swatch.map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))}
        </button>
      ))}
    </div>
  );
}
