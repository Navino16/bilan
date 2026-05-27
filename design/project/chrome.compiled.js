/* Chrome: sidebar, topbar, mobile tab bar — Bilan */

const NAV_ITEMS = [{
  id: "dashboard",
  label: "Tableau de bord",
  icon: "home"
}, {
  id: "transactions",
  label: "Transactions",
  icon: "list"
}, {
  id: "budgets",
  label: "Budgets",
  icon: "target"
}, {
  id: "accounts",
  label: "Comptes",
  icon: "wallet"
}, {
  id: "categories",
  label: "Catégories",
  icon: "tag"
}, {
  id: "links",
  label: "Liens",
  icon: "link"
}, {
  id: "groups",
  label: "Foyer",
  icon: "users"
}, {
  id: "import",
  label: "Importer",
  icon: "upload"
}];
const NAV_ADMIN = [{
  id: "settings",
  label: "Préférences",
  icon: "settings"
}, {
  id: "admin",
  label: "Administration",
  icon: "shield"
}];

// ------- DESKTOP SIDEBAR ------------------------------------------
const Sidebar = ({
  route,
  setRoute,
  scope,
  setScope
}) => {
  const {
    theme,
    setTheme
  } = React.useContext(window.AppContext);
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 240,
      flexShrink: 0,
      borderRight: "1px solid var(--hairline)",
      background: "var(--paper)",
      display: "flex",
      flexDirection: "column",
      padding: "20px 14px 16px",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "4px 8px 16px",
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(BilanMark, {
    size: 26
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 22,
      lineHeight: 1,
      letterSpacing: "-.02em"
    }
  }, "Bilan"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: "var(--ink-3)",
      marginTop: 1,
      letterSpacing: ".08em",
      textTransform: "uppercase"
    }
  }, "Finances \xB7 2026"))), /*#__PURE__*/React.createElement(ScopePicker, {
    scope: scope,
    setScope: setScope
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 8
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      padding: "8px 10px 4px"
    }
  }, "Espace"), NAV_ITEMS.map(it => /*#__PURE__*/React.createElement(NavItem, {
    key: it.id,
    item: it,
    active: route === it.id,
    onClick: () => setRoute(it.id)
  })), /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      padding: "16px 10px 4px"
    }
  }, "Compte"), NAV_ADMIN.map(it => /*#__PURE__*/React.createElement(NavItem, {
    key: it.id,
    item: it,
    active: route === it.id,
    onClick: () => setRoute(it.id)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      padding: "10px 10px",
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: "PD"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      color: "var(--ink)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "Pierre Dupont"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, "SUPER_ADMIN")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setTheme(theme === "light" ? "dark" : "light"),
    title: theme === "light" ? "Passer en thème sombre" : "Passer en thème clair",
    style: {
      color: "var(--ink-3)",
      padding: 6,
      borderRadius: 6,
      border: "1px solid var(--hairline)",
      background: "var(--card)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: theme === "light" ? "moon" : "sun",
    size: 14
  }))));
};
const NavItem = ({
  item,
  active,
  onClick
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  style: {
    height: 32,
    padding: "0 10px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    borderRadius: 7,
    background: active ? "var(--card)" : "transparent",
    color: active ? "var(--ink)" : "var(--ink-2)",
    fontWeight: active ? 500 : 400,
    fontSize: 13,
    textAlign: "left",
    border: active ? "1px solid var(--hairline)" : "1px solid transparent",
    boxShadow: active ? "0 1px 2px rgba(20,17,13,.04)" : "none",
    transition: "all .12s ease"
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    color: active ? "var(--primary)" : "var(--ink-3)",
    display: "flex"
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: item.icon,
  size: 16
})), item.label);

// scope picker (perso / foyer)
const ScopePicker = ({
  scope,
  setScope
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    margin: "4px 0",
    padding: 3,
    background: "var(--paper-2)",
    border: "1px solid var(--hairline)",
    borderRadius: 9,
    display: "flex",
    gap: 2
  }
}, [{
  id: "me",
  label: "Mes données"
}, {
  id: "household",
  label: "Foyer"
}].map(o => /*#__PURE__*/React.createElement("button", {
  key: o.id,
  onClick: () => setScope(o.id),
  style: {
    flex: 1,
    height: 28,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    background: scope === o.id ? "var(--card)" : "transparent",
    color: scope === o.id ? "var(--ink)" : "var(--ink-3)",
    boxShadow: scope === o.id ? "0 1px 2px rgba(0,0,0,.06)" : "none",
    transition: "all .15s ease"
  }
}, o.label)));

// ------- TOP BAR --------------------------------------------------
const Topbar = ({
  route,
  monthIdx,
  setMonthIdx,
  accountFilter,
  setAccountFilter,
  onSearch
}) => {
  const ctx = React.useContext(window.AppContext);
  const months = [{
    label: "mars 2026",
    short: "mars"
  }, {
    label: "avril 2026",
    short: "avril"
  }, {
    label: "mai 2026",
    short: "mai"
  }];
  const current = months[monthIdx];
  const showMonth = ["dashboard", "transactions", "budgets"].includes(route);
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 64,
      flexShrink: 0,
      borderBottom: "1px solid var(--hairline)",
      background: "var(--paper)",
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "0 24px"
    }
  }, showMonth && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMonthIdx(Math.max(0, monthIdx - 1)),
    style: {
      width: 30,
      height: 30,
      borderRadius: 6,
      color: "var(--ink-3)"
    },
    title: "Mois pr\xE9c\xE9dent"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 130,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18,
      letterSpacing: "-.01em"
    }
  }, current.label)), /*#__PURE__*/React.createElement("button", {
    onClick: () => setMonthIdx(Math.min(months.length - 1, monthIdx + 1)),
    disabled: monthIdx === months.length - 1,
    style: {
      width: 30,
      height: 30,
      borderRadius: 6,
      color: monthIdx === months.length - 1 ? "var(--ink-4)" : "var(--ink-3)"
    },
    title: "Mois suivant"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: 380
    }
  }, /*#__PURE__*/React.createElement(Input, {
    icon: "search",
    placeholder: "Rechercher transactions, comptes\u2026",
    onChange: e => onSearch?.(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), showMonth && /*#__PURE__*/React.createElement(AccountFilter, {
    value: accountFilter,
    onChange: setAccountFilter
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "upload",
    size: "sm",
    onClick: () => ctx.setRoute("import")
  }, "Importer"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus",
    size: "sm",
    onClick: () => ctx.setModal("addTransaction")
  }, "Saisir"));
};
const AccountFilter = ({
  value,
  onChange
}) => {
  const [open, setOpen] = React.useState(false);
  const all = {
    id: "all",
    name: "Tous les comptes",
    balance: ACCOUNTS.reduce((s, a) => s + a.balance, 0)
  };
  const current = value === "all" ? all : ACCOUNTS.find(a => a.id === value) || all;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpen(!open),
    style: {
      height: 34,
      padding: "0 10px 0 12px",
      background: "var(--card)",
      border: "1px solid var(--hairline-2)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 13,
      color: "var(--ink)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
      background: current.color || "var(--ink-3)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      maxWidth: 130,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, current.name), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 14
  })), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 38,
      right: 0,
      minWidth: 240,
      background: "var(--card)",
      border: "1px solid var(--hairline)",
      borderRadius: 10,
      padding: 4,
      boxShadow: "var(--shadow-2)",
      zIndex: 50
    }
  }, [all, ...ACCOUNTS].map(a => /*#__PURE__*/React.createElement("button", {
    key: a.id,
    onClick: () => {
      onChange(a.id);
      setOpen(false);
    },
    style: {
      width: "100%",
      padding: "8px 8px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      background: value === a.id ? "var(--paper-2)" : "transparent",
      borderRadius: 6,
      fontSize: 13,
      color: "var(--ink)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
      background: a.color || "var(--ink-3)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      textAlign: "left"
    }
  }, a.name), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, fmtEURcompact(a.balance))))));
};

// ------- MOBILE CHROME --------------------------------------------
const MobileTopbar = ({
  title,
  onMenu,
  right,
  monthIdx,
  setMonthIdx,
  showMonth
}) => {
  const months = ["mars 2026", "avril 2026", "mai 2026"];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 56,
      flexShrink: 0,
      padding: "0 12px",
      background: "var(--paper)",
      borderBottom: "1px solid var(--hairline)",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onMenu,
    style: {
      width: 36,
      height: 36,
      borderRadius: 8,
      color: "var(--ink-2)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "menu",
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18,
      lineHeight: 1.1,
      letterSpacing: "-.01em",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, title), showMonth && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMonthIdx(Math.max(0, monthIdx - 1)),
    style: {
      color: "var(--ink-3)",
      padding: 2
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 12
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, months[monthIdx]), /*#__PURE__*/React.createElement("button", {
    onClick: () => setMonthIdx(Math.min(2, monthIdx + 1)),
    style: {
      color: "var(--ink-3)",
      padding: 2
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 12
  })))), right || /*#__PURE__*/React.createElement("button", {
    style: {
      width: 36,
      height: 36,
      borderRadius: 8,
      color: "var(--ink-2)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  })));
};
const MobileTabBar = ({
  route,
  setRoute
}) => {
  const tabs = [{
    id: "dashboard",
    label: "Accueil",
    icon: "home"
  }, {
    id: "transactions",
    label: "Transac.",
    icon: "list"
  }, {
    id: "budgets",
    label: "Budgets",
    icon: "target"
  }, {
    id: "accounts",
    label: "Comptes",
    icon: "wallet"
  }, {
    id: "settings",
    label: "Profil",
    icon: "settings"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 64,
      flexShrink: 0,
      background: "var(--paper)",
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      padding: "4px 4px 8px"
    }
  }, tabs.map(t => {
    const active = route === t.id;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      onClick: () => setRoute(t.id),
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        color: active ? "var(--primary)" : "var(--ink-3)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: t.icon,
      size: 20,
      stroke: active ? 2 : 1.6
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 500
      }
    }, t.label));
  }));
};

// ------- LOGO ------------------------------------------------------
const BilanMark = ({
  size = 28
}) => /*#__PURE__*/React.createElement("svg", {
  width: size,
  height: size,
  viewBox: "0 0 40 40"
}, /*#__PURE__*/React.createElement("rect", {
  x: "2",
  y: "2",
  width: "36",
  height: "36",
  rx: "9",
  fill: "var(--primary)"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 28 L12 12 L20 12 Q26 12 26 16 Q26 20 22 20 Q28 20 28 24 Q28 28 22 28 Z",
  fill: "none",
  stroke: "var(--primary-ink)",
  strokeWidth: "2.2",
  strokeLinejoin: "round"
}));
Object.assign(window, {
  Sidebar,
  Topbar,
  MobileTopbar,
  MobileTabBar,
  NAV_ITEMS,
  BilanMark
});