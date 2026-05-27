/* Chrome: sidebar, topbar, mobile tab bar — Bilan */

const NAV_ITEMS = [
  { id: "dashboard",    label: "Tableau de bord", icon: "home" },
  { id: "transactions", label: "Transactions",    icon: "list" },
  { id: "budgets",      label: "Budgets",         icon: "target" },
  { id: "accounts",     label: "Comptes",         icon: "wallet" },
  { id: "categories",   label: "Catégories",      icon: "tag" },
  { id: "links",        label: "Liens",           icon: "link" },
  { id: "groups",       label: "Foyer",           icon: "users" },
  { id: "import",       label: "Importer",        icon: "upload" },
];

const NAV_ADMIN = [
  { id: "settings",     label: "Préférences",     icon: "settings" },
  { id: "admin",        label: "Administration",  icon: "shield" },
];

// ------- DESKTOP SIDEBAR ------------------------------------------
const Sidebar = ({ route, setRoute, scope, setScope }) => {
  const { theme, setTheme } = React.useContext(window.AppContext);
  return (
    <aside style={{
      width: 240, flexShrink: 0,
      borderRight: "1px solid var(--hairline)",
      background: "var(--paper)",
      display: "flex", flexDirection: "column",
      padding: "20px 14px 16px",
      gap: 4,
    }}>
      {/* logo */}
      <div style={{ padding: "4px 8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <BilanMark size={26} />
        <div>
          <div className="serif" style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-.02em" }}>Bilan</div>
          <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1, letterSpacing: ".08em", textTransform: "uppercase" }}>Finances · 2026</div>
        </div>
      </div>

      {/* scope switcher */}
      <ScopePicker scope={scope} setScope={setScope} />

      <div style={{ height: 8 }} />
      <div className="overline" style={{ padding: "8px 10px 4px" }}>Espace</div>
      {NAV_ITEMS.map(it => (
        <NavItem key={it.id} item={it} active={route === it.id} onClick={() => setRoute(it.id)} />
      ))}
      <div className="overline" style={{ padding: "16px 10px 4px" }}>Compte</div>
      {NAV_ADMIN.map(it => (
        <NavItem key={it.id} item={it} active={route === it.id} onClick={() => setRoute(it.id)} />
      ))}

      <div style={{ flex: 1 }} />

      {/* user card */}
      <div style={{
        marginTop: 12, padding: "10px 10px",
        borderTop: "1px solid var(--hairline)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <Avatar initials="PD" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Pierre Dupont</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>SUPER_ADMIN</div>
        </div>
        <button
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          title={theme === "light" ? "Passer en thème sombre" : "Passer en thème clair"}
          style={{ color: "var(--ink-3)", padding: 6, borderRadius: 6, border: "1px solid var(--hairline)", background: "var(--card)" }}
        >
          <Icon name={theme === "light" ? "moon" : "sun"} size={14} />
        </button>
      </div>
    </aside>
  );
};

const NavItem = ({ item, active, onClick }) => (
  <button onClick={onClick} style={{
    height: 32, padding: "0 10px",
    display: "flex", alignItems: "center", gap: 10,
    borderRadius: 7,
    background: active ? "var(--card)" : "transparent",
    color: active ? "var(--ink)" : "var(--ink-2)",
    fontWeight: active ? 500 : 400,
    fontSize: 13, textAlign: "left",
    border: active ? "1px solid var(--hairline)" : "1px solid transparent",
    boxShadow: active ? "0 1px 2px rgba(20,17,13,.04)" : "none",
    transition: "all .12s ease",
  }}>
    <span style={{ color: active ? "var(--primary)" : "var(--ink-3)", display: "flex" }}>
      <Icon name={item.icon} size={16} />
    </span>
    {item.label}
  </button>
);

// scope picker (perso / foyer)
const ScopePicker = ({ scope, setScope }) => (
  <div style={{
    margin: "4px 0",
    padding: 3,
    background: "var(--paper-2)",
    border: "1px solid var(--hairline)",
    borderRadius: 9,
    display: "flex", gap: 2,
  }}>
    {[
      { id: "me", label: "Mes données" },
      { id: "household", label: "Foyer" },
    ].map(o => (
      <button key={o.id} onClick={() => setScope(o.id)} style={{
        flex: 1, height: 28, borderRadius: 6, fontSize: 12, fontWeight: 500,
        background: scope === o.id ? "var(--card)" : "transparent",
        color: scope === o.id ? "var(--ink)" : "var(--ink-3)",
        boxShadow: scope === o.id ? "0 1px 2px rgba(0,0,0,.06)" : "none",
        transition: "all .15s ease",
      }}>{o.label}</button>
    ))}
  </div>
);

// ------- TOP BAR --------------------------------------------------
const Topbar = ({ route, monthIdx, setMonthIdx, accountFilter, setAccountFilter, onSearch }) => {
  const ctx = React.useContext(window.AppContext);
  const months = [
    { label: "mars 2026", short: "mars" },
    { label: "avril 2026", short: "avril" },
    { label: "mai 2026", short: "mai" },
  ];
  const current = months[monthIdx];
  const showMonth = ["dashboard", "transactions", "budgets"].includes(route);
  return (
    <header style={{
      height: 64, flexShrink: 0,
      borderBottom: "1px solid var(--hairline)",
      background: "var(--paper)",
      display: "flex", alignItems: "center", gap: 16, padding: "0 24px",
    }}>
      {showMonth && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setMonthIdx(Math.max(0, monthIdx - 1))} style={{ width: 30, height: 30, borderRadius: 6, color: "var(--ink-3)" }} title="Mois précédent">
            <Icon name="chevron-left" size={16} />
          </button>
          <div style={{ minWidth: 130, textAlign: "center" }}>
            <div className="serif" style={{ fontSize: 18, letterSpacing: "-.01em" }}>{current.label}</div>
          </div>
          <button onClick={() => setMonthIdx(Math.min(months.length - 1, monthIdx + 1))} disabled={monthIdx === months.length - 1} style={{ width: 30, height: 30, borderRadius: 6, color: monthIdx === months.length - 1 ? "var(--ink-4)" : "var(--ink-3)" }} title="Mois suivant">
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      )}

      {/* search */}
      <div style={{ flex: 1, maxWidth: 380 }}>
        <Input icon="search" placeholder="Rechercher transactions, comptes…" onChange={(e) => onSearch?.(e.target.value)} />
      </div>

      <div style={{ flex: 1 }} />

      {/* account filter */}
      {showMonth && <AccountFilter value={accountFilter} onChange={setAccountFilter} />}

      <Button variant="secondary" icon="upload" size="sm" onClick={() => ctx.setRoute("import")}>Importer</Button>
      <Button variant="primary" icon="plus" size="sm" onClick={() => ctx.setModal("addTransaction")}>Saisir</Button>
    </header>
  );
};

const AccountFilter = ({ value, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const all = { id: "all", name: "Tous les comptes", balance: ACCOUNTS.reduce((s, a) => s + a.balance, 0) };
  const current = value === "all" ? all : ACCOUNTS.find(a => a.id === value) || all;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        height: 34, padding: "0 10px 0 12px",
        background: "var(--card)", border: "1px solid var(--hairline-2)",
        borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
        fontSize: 13, color: "var(--ink)",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 8, background: current.color || "var(--ink-3)" }} />
        <span style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.name}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: 38, right: 0, minWidth: 240,
          background: "var(--card)", border: "1px solid var(--hairline)",
          borderRadius: 10, padding: 4,
          boxShadow: "var(--shadow-2)", zIndex: 50,
        }}>
          {[all, ...ACCOUNTS].map(a => (
            <button key={a.id} onClick={() => { onChange(a.id); setOpen(false); }} style={{
              width: "100%", padding: "8px 8px",
              display: "flex", alignItems: "center", gap: 10,
              background: value === a.id ? "var(--paper-2)" : "transparent",
              borderRadius: 6, fontSize: 13, color: "var(--ink)",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: a.color || "var(--ink-3)" }} />
              <span style={{ flex: 1, textAlign: "left" }}>{a.name}</span>
              <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{fmtEURcompact(a.balance)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ------- MOBILE CHROME --------------------------------------------
const MobileTopbar = ({ title, onMenu, right, monthIdx, setMonthIdx, showMonth }) => {
  const months = ["mars 2026", "avril 2026", "mai 2026"];
  return (
    <div style={{
      height: 56, flexShrink: 0, padding: "0 12px",
      background: "var(--paper)", borderBottom: "1px solid var(--hairline)",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <button onClick={onMenu} style={{ width: 36, height: 36, borderRadius: 8, color: "var(--ink-2)" }}>
        <Icon name="menu" size={18} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="serif" style={{ fontSize: 18, lineHeight: 1.1, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        {showMonth && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
            <button onClick={() => setMonthIdx(Math.max(0, monthIdx - 1))} style={{ color: "var(--ink-3)", padding: 2 }}><Icon name="chevron-left" size={12} /></button>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{months[monthIdx]}</span>
            <button onClick={() => setMonthIdx(Math.min(2, monthIdx + 1))} style={{ color: "var(--ink-3)", padding: 2 }}><Icon name="chevron-right" size={12} /></button>
          </div>
        )}
      </div>
      {right || <button style={{ width: 36, height: 36, borderRadius: 8, color: "var(--ink-2)" }}><Icon name="search" size={18} /></button>}
    </div>
  );
};

const MobileTabBar = ({ route, setRoute }) => {
  const tabs = [
    { id: "dashboard",    label: "Accueil",  icon: "home" },
    { id: "transactions", label: "Transac.", icon: "list" },
    { id: "budgets",      label: "Budgets",  icon: "target" },
    { id: "accounts",     label: "Comptes",  icon: "wallet" },
    { id: "settings",     label: "Profil",   icon: "settings" },
  ];
  return (
    <div style={{
      height: 64, flexShrink: 0,
      background: "var(--paper)", borderTop: "1px solid var(--hairline)",
      display: "flex", padding: "4px 4px 8px",
    }}>
      {tabs.map(t => {
        const active = route === t.id;
        return (
          <button key={t.id} onClick={() => setRoute(t.id)} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
            color: active ? "var(--primary)" : "var(--ink-3)",
          }}>
            <Icon name={t.icon} size={20} stroke={active ? 2 : 1.6} />
            <span style={{ fontSize: 10, fontWeight: 500 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
};

// ------- LOGO ------------------------------------------------------
const BilanMark = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40">
    <rect x="2" y="2" width="36" height="36" rx="9" fill="var(--primary)" />
    <path d="M12 28 L12 12 L20 12 Q26 12 26 16 Q26 20 22 20 Q28 20 28 24 Q28 28 22 28 Z" fill="none" stroke="var(--primary-ink)" strokeWidth="2.2" strokeLinejoin="round" />
  </svg>
);

Object.assign(window, { Sidebar, Topbar, MobileTopbar, MobileTabBar, NAV_ITEMS, BilanMark });
