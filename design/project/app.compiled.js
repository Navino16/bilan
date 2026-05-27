/* Bilan — app shell with desktop + mobile side by side on a black canvas */

const {
  useState,
  useEffect,
  useContext,
  createContext
} = React;
const SCREENS = {
  dashboard: {
    component: () => DashboardScreen,
    title: "Tableau de bord"
  },
  transactions: {
    component: () => TransactionsScreen,
    title: "Transactions"
  },
  budgets: {
    component: () => BudgetsScreen,
    title: "Budgets"
  },
  accounts: {
    component: () => AccountsScreen,
    title: "Comptes"
  },
  categories: {
    component: () => CategoriesScreen,
    title: "Catégories"
  },
  links: {
    component: () => LinksScreen,
    title: "Liens"
  },
  groups: {
    component: () => GroupsScreen,
    title: "Foyer"
  },
  import: {
    component: () => ImportScreen,
    title: "Importer"
  },
  settings: {
    component: () => SettingsScreen,
    title: "Préférences"
  },
  admin: {
    component: () => AdminScreen,
    title: "Administration"
  },
  auth: {
    component: () => AuthScreen,
    title: "Connexion"
  }
};

// Fixed defaults — these were tweakable, now confirmed product choices.
const DASHBOARD_LAYOUT = "editorial";
const BUDGET_VIZ = "bar";

// EDITMODE — kept for future small tweaks; for now we expose nothing.
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "forest"
} /*EDITMODE-END*/;

// App-level shared state context (theme + density)
const AppContext = createContext({});
window.AppContext = AppContext;
function App() {
  const [route, setRoute] = useState("dashboard");
  const [scope, setScope] = useState("me");
  const [monthIdx, setMonthIdx] = useState(2);
  const [theme, setTheme] = useState("light");
  const [density, setDensity] = useState("cozy");
  const [modal, setModal] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useTweaks(TWEAK_DEFAULTS);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-density", density);
  }, [theme, density]);
  const ctxValue = {
    theme,
    setTheme,
    density,
    setDensity,
    scope,
    setScope,
    route,
    setRoute,
    modal,
    setModal,
    drawerOpen,
    setDrawerOpen
  };
  return /*#__PURE__*/React.createElement(AppContext.Provider, {
    value: ctxValue
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      width: "100vw",
      padding: "32px 24px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 28,
      background: "linear-gradient(180deg, #1F1B16 0%, #2A2723 50%, #1F1B16 100%)",
      backgroundAttachment: "fixed"
    }
  }, /*#__PURE__*/React.createElement(TopChrome, {
    route: route,
    setRoute: setRoute
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 28,
      alignItems: "flex-start",
      flexWrap: "wrap",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(DesktopFrame, {
    screen: route,
    monthIdx: monthIdx,
    setMonthIdx: setMonthIdx
  }), /*#__PURE__*/React.createElement(MobileFrame, {
    screen: route,
    monthIdx: monthIdx,
    setMonthIdx: setMonthIdx
  })), /*#__PURE__*/React.createElement(BottomCredits, null)));
}

// -------- TOP CHROME (screen selector for the prototype) ---------
function TopChrome({
  route,
  setRoute
}) {
  const screens = [{
    id: "dashboard",
    label: "Tableau de bord"
  }, {
    id: "transactions",
    label: "Transactions"
  }, {
    id: "budgets",
    label: "Budgets"
  }, {
    id: "accounts",
    label: "Comptes"
  }, {
    id: "categories",
    label: "Catégories"
  }, {
    id: "links",
    label: "Liens"
  }, {
    id: "groups",
    label: "Foyer"
  }, {
    id: "import",
    label: "Import CSV"
  }, {
    id: "auth",
    label: "Auth"
  }, {
    id: "settings",
    label: "Préférences"
  }, {
    id: "admin",
    label: "Admin"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      maxWidth: 1900,
      display: "flex",
      alignItems: "center",
      gap: 18,
      flexWrap: "wrap",
      padding: "4px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      color: "#E8E2D2"
    }
  }, /*#__PURE__*/React.createElement(BilanMark, {
    size: 32
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 22,
      lineHeight: 1,
      color: "#E8E2D2",
      letterSpacing: "-.015em"
    }
  }, "Bilan"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      textTransform: "uppercase",
      letterSpacing: ".12em",
      color: "rgba(232,226,210,.45)",
      marginTop: 2
    }
  }, "Maquette interactive \xB7 v0.9"))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 24,
      width: 1,
      background: "rgba(232,226,210,.15)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexWrap: "wrap",
      gap: 4,
      padding: 4,
      background: "rgba(232,226,210,.05)",
      borderRadius: 10,
      border: "1px solid rgba(232,226,210,.08)"
    }
  }, screens.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    onClick: () => setRoute(s.id),
    style: {
      padding: "7px 12px",
      borderRadius: 7,
      background: route === s.id ? "rgba(232,226,210,.95)" : "transparent",
      color: route === s.id ? "#1F1B16" : "rgba(232,226,210,.7)",
      fontSize: 12.5,
      fontWeight: route === s.id ? 500 : 400,
      fontFamily: "var(--font-sans)",
      letterSpacing: "-.005em",
      transition: "all .15s ease"
    }
  }, s.label))));
}

// -------- DESKTOP FRAME ------------------------------------------
function DesktopFrame({
  screen,
  monthIdx,
  setMonthIdx
}) {
  const {
    route,
    setRoute,
    scope,
    setScope,
    modal,
    setModal
  } = useContext(AppContext);
  const Comp = SCREENS[screen].component();
  const isAuth = screen === "auth";
  return /*#__PURE__*/React.createElement(FrameShell, {
    label: "Desktop \xB7 1440 \xD7 900",
    width: 1440,
    height: 900
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      display: "flex",
      background: "var(--paper)",
      position: "relative"
    }
  }, !isAuth && /*#__PURE__*/React.createElement(Sidebar, {
    route: screen,
    setRoute: setRoute,
    scope: scope,
    setScope: setScope
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      overflow: "hidden"
    }
  }, !isAuth && /*#__PURE__*/React.createElement(Topbar, {
    route: screen,
    monthIdx: monthIdx,
    setMonthIdx: setMonthIdx,
    accountFilter: "all",
    setAccountFilter: () => {}
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto"
    },
    className: "scrollbar"
  }, /*#__PURE__*/React.createElement(Comp, {
    device: "desktop",
    monthIdx: monthIdx,
    scope: scope,
    layout: DASHBOARD_LAYOUT,
    budgetViz: BUDGET_VIZ
  }))), /*#__PURE__*/React.createElement(ModalHost, {
    device: "desktop",
    modal: modal,
    onClose: () => setModal(null)
  })));
}

// -------- MOBILE FRAME -------------------------------------------
function MobileFrame({
  screen,
  monthIdx,
  setMonthIdx
}) {
  const {
    route,
    setRoute,
    scope,
    modal,
    setModal,
    drawerOpen,
    setDrawerOpen,
    theme,
    setTheme
  } = useContext(AppContext);
  const Comp = SCREENS[screen].component();
  const isAuth = screen === "auth";
  const title = SCREENS[screen].title;
  const showMonth = ["dashboard", "transactions", "budgets"].includes(screen);
  const MOBILE_PRIMARY = {
    dashboard: {
      icon: "plus",
      label: "Saisir",
      kind: "addTransaction"
    },
    transactions: {
      icon: "plus",
      label: "Saisir",
      kind: "addTransaction"
    },
    budgets: {
      icon: "plus",
      label: "Nouveau budget",
      kind: "addBudget"
    },
    accounts: {
      icon: "plus",
      label: "Ajouter un compte",
      kind: "addAccount"
    },
    categories: {
      icon: "plus",
      label: "Nouvelle catégorie",
      kind: "addCategory"
    },
    links: {
      icon: "link",
      label: "Mode liaison",
      kind: null
    },
    groups: {
      icon: "plus",
      label: "Inviter",
      kind: "inviteMember"
    },
    import: {
      icon: "upload",
      label: "Nouveau fichier",
      kind: null
    }
  };
  const primary = MOBILE_PRIMARY[screen];
  const rightSlot = primary ? /*#__PURE__*/React.createElement("button", {
    title: primary.label,
    onClick: () => primary.kind && setModal(primary.kind),
    style: {
      width: 36,
      height: 36,
      borderRadius: 8,
      background: "var(--primary)",
      color: "var(--primary-ink)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: primary.icon,
    size: 18
  })) : null;
  return /*#__PURE__*/React.createElement(PhoneFrame, {
    label: "Mobile \xB7 390 \xD7 844"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "var(--paper)",
      overflow: "hidden",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement(StatusBar, null), !isAuth && /*#__PURE__*/React.createElement(MobileTopbar, {
    title: title,
    monthIdx: monthIdx,
    setMonthIdx: setMonthIdx,
    showMonth: showMonth,
    right: rightSlot,
    onMenu: () => setDrawerOpen(true)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto",
      position: "relative"
    },
    className: "scrollbar"
  }, /*#__PURE__*/React.createElement(Comp, {
    device: "mobile",
    monthIdx: monthIdx,
    scope: scope,
    layout: DASHBOARD_LAYOUT,
    budgetViz: BUDGET_VIZ
  })), !isAuth && /*#__PURE__*/React.createElement(MobileTabBar, {
    route: screen,
    setRoute: setRoute
  }), /*#__PURE__*/React.createElement(MobileDrawer, {
    open: drawerOpen,
    onClose: () => setDrawerOpen(false),
    route: screen,
    setRoute: setRoute,
    theme: theme,
    setTheme: setTheme
  }), /*#__PURE__*/React.createElement(ModalHost, {
    device: "mobile",
    modal: modal,
    onClose: () => setModal(null)
  })));
}
function ModalHost({
  device,
  modal,
  onClose
}) {
  if (!modal) return null;
  const map = {
    addTransaction: AddTransactionForm,
    addAccount: AddAccountForm,
    addCategory: AddCategoryForm,
    addBudget: AddBudgetForm,
    inviteMember: InviteMemberForm
  };
  const Form = map[modal];
  if (!Form) return null;
  return /*#__PURE__*/React.createElement(Form, {
    device: device,
    onClose: onClose
  });
}

// -------- FRAME SHELLS -------------------------------------------
function FrameShell({
  children,
  label,
  width,
  height
}) {
  const targetW = 1100;
  const scale = Math.min(1, targetW / width);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: width * scale,
      height: height * scale,
      borderRadius: 14,
      overflow: "hidden",
      background: "var(--paper)",
      border: "1px solid rgba(232,226,210,.12)",
      boxShadow: "0 30px 80px rgba(0,0,0,.45), 0 6px 16px rgba(0,0,0,.3)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      height,
      transform: `scale(${scale})`,
      transformOrigin: "top left"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 32,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 16px",
      background: "var(--paper-2)",
      borderBottom: "1px solid var(--hairline)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 10,
      background: "#E5605E"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 10,
      background: "#E5C04A"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 10,
      background: "#7CC25E"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)",
      fontFamily: "var(--font-mono)"
    }
  }, "bilan.dupont.fr"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      height: height - 32
    }
  }, children))), /*#__PURE__*/React.createElement(FrameLabel, {
    label: label
  }));
}
function PhoneFrame({
  children,
  label
}) {
  const w = 390,
    h = 844;
  const scale = 0.72;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: w * scale + 24,
      height: h * scale + 24,
      background: "linear-gradient(180deg, #111 0%, #1a1a1a 100%)",
      borderRadius: 52 * scale + 12,
      padding: 12,
      position: "relative",
      boxShadow: "0 30px 80px rgba(0,0,0,.5), 0 6px 16px rgba(0,0,0,.3), inset 0 0 0 1px rgba(255,255,255,.06)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: w * scale,
      height: h * scale,
      borderRadius: 44 * scale,
      overflow: "hidden",
      position: "relative",
      background: "var(--paper)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: w,
      height: h,
      transform: `scale(${scale})`,
      transformOrigin: "top left"
    }
  }, children))), /*#__PURE__*/React.createElement(FrameLabel, {
    label: label
  }));
}
function StatusBar() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      flexShrink: 0,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      padding: "0 22px 4px",
      fontSize: 14,
      fontWeight: 600,
      color: "var(--ink)",
      fontFamily: "var(--font-sans)",
      background: "var(--paper)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFeatureSettings: "'tnum'"
    }
  }, "9:41"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "11",
    viewBox: "0 0 18 11"
  }, /*#__PURE__*/React.createElement("path", {
    fill: "currentColor",
    d: "M1 7h2v3H1zM5 4h2v6H5zM9 1h2v9H9zM13 -2h2v12h-2z",
    transform: "translate(0 2)"
  })), /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "11",
    viewBox: "0 0 14 11"
  }, /*#__PURE__*/React.createElement("path", {
    fill: "currentColor",
    d: "M7 9.5c.7 0 1.3.3 1.7.7L7 12 5.3 10.2c.4-.4 1-.7 1.7-.7zm0-3c1.5 0 2.8.5 3.8 1.5l-1.2 1.2C8.9 8.5 8 8.2 7 8.2s-1.9.3-2.6 1l-1.2-1.2C4.2 7 5.5 6.5 7 6.5zm0-3c2.3 0 4.4.9 6 2.4l-1.2 1.2C10.5 5.9 8.8 5.2 7 5.2s-3.5.7-4.8 1.9L1 5.9c1.6-1.5 3.7-2.4 6-2.4z"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 22,
      height: 11,
      border: "1px solid currentColor",
      borderRadius: 3,
      padding: 1,
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      width: "85%",
      height: "100%",
      background: "currentColor",
      borderRadius: 1
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 2,
      height: 4,
      background: "currentColor",
      borderRadius: 1,
      marginLeft: 1
    }
  }))));
}
function FrameLabel({
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "4px 10px",
      background: "rgba(232,226,210,.06)",
      border: "1px solid rgba(232,226,210,.1)",
      borderRadius: 999,
      fontSize: 11,
      color: "rgba(232,226,210,.55)",
      fontFamily: "var(--font-mono)",
      letterSpacing: ".02em"
    }
  }, label));
}
function BottomCredits() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "24px 0 12px",
      textAlign: "center",
      color: "rgba(232,226,210,.4)",
      fontSize: 11.5,
      lineHeight: 1.6,
      maxWidth: 720
    }
  }, "Le th\xE8me (clair/sombre) est natif\u202F: basculez via l'ic\xF4ne lune/soleil dans la barre lat\xE9rale ou depuis Pr\xE9f\xE9rences \u203A Profil.", /*#__PURE__*/React.createElement("br", null), "Cliquez sur une transaction pour le d\xE9tail \xB7 sur la cat\xE9gorie pour proposer une r\xE8gle.");
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));