/* Budgets, Accounts, Categories, Links, Groups screens */

// ============== BUDGETS ==========================================
const BudgetsScreen = ({
  device,
  monthIdx,
  budgetViz = "bar",
  scope
}) => {
  const isMobile = device === "mobile";
  const [activeBudgetId, setActiveBudgetId] = React.useState("b_may");
  const ctx = React.useContext(window.AppContext);
  const b = BUDGETS.find(x => x.id === activeBudgetId);
  const total = b.lines.reduce((s, l) => s + l.spent, 0);
  const planned = b.lines.reduce((s, l) => s + l.planned, 0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? 16 : 32,
      paddingBottom: isMobile ? 96 : 32
    }
  }, !isMobile && /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 24,
      alignItems: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 6
    }
  }, "Budgets \xB7 ", scope === "household" ? "Foyer" : "Personnel"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32,
      lineHeight: 1.1
    }
  }, "Mes budgets"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--ink-3)",
      marginTop: 4,
      fontSize: 13.5
    }
  }, "Plan + suivi pour chaque cat\xE9gorie ce mois.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "download",
    size: "sm"
  }, "Exporter"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus",
    size: "sm",
    onClick: () => ctx.setModal("addBudget")
  }, "Nouveau budget"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 20
    }
  }, BUDGETS.map(bd => /*#__PURE__*/React.createElement("button", {
    key: bd.id,
    onClick: () => setActiveBudgetId(bd.id),
    style: {
      padding: "8px 14px",
      borderRadius: 999,
      background: activeBudgetId === bd.id ? "var(--ink)" : "var(--card)",
      color: activeBudgetId === bd.id ? "var(--paper)" : "var(--ink-2)",
      border: "1px solid " + (activeBudgetId === bd.id ? "var(--ink)" : "var(--hairline-2)"),
      fontSize: 13,
      fontWeight: 500
    }
  }, bd.name, " ", bd.scope === "group" && /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: 0.7,
      marginLeft: 6
    }
  }, "\xB7 foyer")))), /*#__PURE__*/React.createElement(Card, {
    padding: isMobile ? 20 : 28
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      alignItems: isMobile ? "stretch" : "center",
      gap: isMobile ? 16 : 28
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "Du 1 au 31 mai 2026"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 30,
      lineHeight: 1.1,
      margin: "4px 0 12px"
    }
  }, b.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 24,
      marginBottom: 16,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 2
    }
  }, "D\xE9pens\xE9"), /*#__PURE__*/React.createElement("div", {
    className: "num serif",
    style: {
      fontSize: 28,
      color: total > planned ? "var(--expense)" : "var(--ink)"
    }
  }, fmtEUR(total, {
    decimals: 0
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 2
    }
  }, "Plafond"), /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      fontSize: 22,
      color: "var(--ink-2)"
    }
  }, fmtEUR(planned, {
    decimals: 0
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 2
    }
  }, "Reste"), /*#__PURE__*/React.createElement("div", {
    className: "num serif",
    style: {
      fontSize: 28,
      color: total <= planned ? "var(--income)" : "var(--expense)"
    }
  }, fmtEUR(planned - total, {
    sign: true,
    decimals: 0
  })))), /*#__PURE__*/React.createElement(BudgetBar, {
    spent: total,
    planned: planned,
    height: 10
  }), /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginTop: 8,
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement("span", null, Math.round(total / planned * 100), " % du budget consomm\xE9"), /*#__PURE__*/React.createElement("span", null, "jour 26/31 \xB7 projection ", fmtEUR(total / 26 * 31, {
    decimals: 0
  })))), !isMobile && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 220,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Donut, {
    size: 200,
    thickness: 22,
    data: b.lines.map(l => ({
      value: l.spent,
      color: findCat(l.categoryId).color
    })),
    centerLabel: `${Math.round(total / planned * 100)} %`,
    centerSub: "consomm\xE9"
  })))), /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      padding: "18px 24px 12px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, "Lignes du budget"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-3)"
    }
  }, "Visualisation\u202F: ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-2)",
      textTransform: "capitalize"
    }
  }, {
    bar: "barre",
    gauge: "jauge",
    ring: "anneau",
    spark: "courbe"
  }[budgetViz]))), b.lines.map(l => {
    const cat = findCat(l.categoryId);
    const ratio = l.spent / l.planned;
    const over = ratio > 1;
    return /*#__PURE__*/React.createElement("div", {
      key: l.id,
      style: {
        padding: "16px 24px",
        borderTop: "1px solid var(--hairline)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "between",
      style: {
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "row",
      style: {
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 10,
        height: 10,
        borderRadius: 10,
        background: cat.color
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        color: "var(--ink)",
        fontWeight: 500
      }
    }, cat.name), over && /*#__PURE__*/React.createElement(Pill, {
      tone: "danger"
    }, "+ ", fmtEUR(l.spent - l.planned, {
      decimals: 0
    })), ratio >= 0.85 && !over && /*#__PURE__*/React.createElement(Pill, {
      tone: "warning"
    }, "Proche du plafond")), /*#__PURE__*/React.createElement("div", {
      className: "num",
      style: {
        fontSize: 14,
        color: over ? "var(--expense)" : "var(--ink)"
      }
    }, fmtEUR(l.spent), " ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ink-3)"
      }
    }, " / ", fmtEUR(l.planned)))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 6
      }
    }, budgetViz === "bar" && /*#__PURE__*/React.createElement(BudgetBar, {
      spent: l.spent,
      planned: l.planned,
      height: 10
    }), budgetViz === "gauge" && /*#__PURE__*/React.createElement(BudgetGauge, {
      spent: l.spent,
      planned: l.planned,
      color: cat.color
    }), budgetViz === "ring" && /*#__PURE__*/React.createElement(BudgetRingLine, {
      spent: l.spent,
      planned: l.planned,
      color: cat.color
    }), budgetViz === "spark" && /*#__PURE__*/React.createElement(BudgetSpark, {
      spent: l.spent,
      planned: l.planned,
      color: cat.color
    })), /*#__PURE__*/React.createElement("div", {
      className: "between",
      style: {
        marginTop: 8,
        fontSize: 11.5,
        color: "var(--ink-3)"
      }
    }, /*#__PURE__*/React.createElement("span", null, Math.round(ratio * 100), " % \xB7 ", (l.spent / 26).toFixed(0), " \u20AC / jour moyen"), /*#__PURE__*/React.createElement("button", {
      style: {
        color: "var(--ink-3)",
        fontSize: 11.5,
        textDecoration: "underline",
        textDecorationStyle: "dotted"
      }
    }, "Affecter une transaction")));
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16,
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    icon: "plus",
    size: "sm"
  }, "Ajouter une ligne"))));
};

// ============== ACCOUNTS =========================================
const AccountsScreen = ({
  device
}) => {
  const isMobile = device === "mobile";
  const [showShare, setShowShare] = React.useState(false);
  const ctx = React.useContext(window.AppContext);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? 16 : 32,
      paddingBottom: isMobile ? 96 : 32
    }
  }, !isMobile && /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "Patrimoine"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32,
      lineHeight: 1.1
    }
  }, "Comptes")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus",
    size: "sm",
    onClick: () => ctx.setModal("addAccount")
  }, "Ajouter un compte")), /*#__PURE__*/React.createElement(Card, {
    padding: isMobile ? 18 : 24,
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 16,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "Solde global"), /*#__PURE__*/React.createElement("div", {
    className: "num serif",
    style: {
      fontSize: 40,
      lineHeight: 1,
      marginTop: 4
    }
  }, fmtEUR(ACCOUNTS.reduce((s, a) => s + a.balance, 0), {
    decimals: 2
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Pill, {
    tone: "success",
    dot: true
  }, "+ 1 240 \u20AC ce mois")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      height: 12,
      display: "flex",
      borderRadius: 6,
      overflow: "hidden"
    }
  }, ACCOUNTS.map((a, i) => {
    const total = ACCOUNTS.reduce((s, x) => s + x.balance, 0);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      title: a.name,
      style: {
        flex: a.balance / total,
        background: a.color
      }
    });
  })), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      marginTop: 8,
      gap: 14,
      flexWrap: "wrap"
    }
  }, ACCOUNTS.map(a => /*#__PURE__*/React.createElement("div", {
    key: a.id,
    className: "row",
    style: {
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
      background: a.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, a.name))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
      gap: 14
    }
  }, ACCOUNTS.map(a => /*#__PURE__*/React.createElement(Card, {
    key: a.id,
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 30,
      borderRadius: 3,
      background: a.color
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--ink)",
      fontWeight: 500
    }
  }, a.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, a.bank, " \xB7 ", labelAccType(a.type)))), /*#__PURE__*/React.createElement("button", {
    style: {
      color: "var(--ink-3)",
      padding: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "more",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: "num serif",
    style: {
      fontSize: 26,
      color: a.balance < 0 ? "var(--expense)" : "var(--ink)"
    }
  }, fmtEUR(a.balance)), a.iban && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--ink-3)",
      marginTop: 4
    }
  }, a.iban), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      paddingTop: 12,
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, a.sharedWith.length > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Pill, {
    tone: "primary",
    soft: true,
    dot: true
  }, "Partag\xE9 \xB7 ", a.permission === "WRITE" ? "écriture" : "lecture"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      marginLeft: 4
    }
  }, HOUSEHOLD.members.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m.id,
    style: {
      marginLeft: i === 0 ? 0 : -8
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: m.initials,
    size: 22
  }))))) : /*#__PURE__*/React.createElement(Pill, {
    tone: "neutral"
  }, "Priv\xE9"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "share",
    onClick: () => setShowShare(a.id)
  }, "Partager"))))), showShare && /*#__PURE__*/React.createElement(ShareDialog, {
    account: ACCOUNTS.find(a => a.id === showShare),
    onClose: () => setShowShare(false)
  }));
};
const labelAccType = t => ({
  CHECKING: "Compte courant",
  SAVINGS: "Livret épargne",
  CREDIT: "Crédit",
  OTHER: "Autre"
})[t];
const ShareDialog = ({
  account,
  onClose
}) => {
  const [perm, setPerm] = React.useState(account.permission || "READ");
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: "absolute",
      inset: 0,
      zIndex: 30,
      background: "rgba(20,17,13,.45)",
      backdropFilter: "blur(2px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: "var(--card)",
      border: "1px solid var(--hairline)",
      borderRadius: 16,
      width: 460,
      maxWidth: "100%",
      boxShadow: "var(--shadow-3)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 24px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 6
    }
  }, "Partage de compte"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 22
    }
  }, "Partager \xAB ", account.name, " \xBB"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-3)",
      marginTop: 4
    }
  }, "Les membres pourront consulter \u2014 et selon la permission \u2014 modifier les transactions de ce compte.")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 24px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Groupe"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      background: "var(--paper-2)",
      border: "1px solid var(--hairline)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 14
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5
    }
  }, "Foyer Dupont"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, "2 membres"))), /*#__PURE__*/React.createElement(Field, {
    label: "Permission"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "READ",
      label: "Lecture seule"
    }, {
      id: "WRITE",
      label: "Lecture + écriture"
    }],
    active: perm,
    onChange: setPerm
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      background: "var(--warning-bg)",
      borderRadius: 8,
      fontSize: 12,
      color: "var(--warning)",
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, "Les transactions affect\xE9es \xE0 un budget partag\xE9 restent visibles par le groupe, m\xEAme si le compte est priv\xE9."))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 24px",
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      justifyContent: "flex-end",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: onClose
  }, "Annuler"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "check"
  }, "Partager"))));
};

// ============== CATEGORIES & RULES ==============================
const CategoriesScreen = ({
  device
}) => {
  const isMobile = device === "mobile";
  const [tab, setTab] = React.useState("cats");
  const ctx = React.useContext(window.AppContext);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? 16 : 32,
      paddingBottom: isMobile ? 96 : 32
    }
  }, !isMobile && /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "Organisation"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32
    }
  }, "Cat\xE9gories & r\xE8gles")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus",
    size: "sm",
    onClick: () => ctx.setModal("addCategory")
  }, tab === "cats" ? "Nouvelle catégorie" : "Nouvelle règle")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "cats",
      label: `Catégories (${CATEGORIES.length})`
    }, {
      id: "rules",
      label: `Règles (${RULES.length})`
    }],
    active: tab,
    onChange: setTab
  })), tab === "cats" && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, CATEGORIES.filter(c => !c.parentId).map(c => {
    const children = CATEGORIES.filter(x => x.parentId === c.id);
    return /*#__PURE__*/React.createElement("div", {
      key: c.id,
      style: {
        borderTop: "1px solid var(--hairline)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 28,
        height: 28,
        borderRadius: 8,
        background: c.color,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14
      }
    }, c.icon), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        color: "var(--ink)"
      }
    }, c.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: "var(--ink-3)"
      }
    }, c.scope === "group" ? "Foyer Dupont" : "Personnel", " \xB7 ", RULES.filter(r => r.categoryId === c.id).length, " r\xE8gle(s)")), /*#__PURE__*/React.createElement(Pill, {
      tone: "neutral"
    }, children.length > 0 ? `${children.length} sous-cat.` : "—"), /*#__PURE__*/React.createElement("button", {
      style: {
        color: "var(--ink-3)",
        padding: 4
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "edit",
      size: 14
    }))), children.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        paddingLeft: 60,
        paddingBottom: 8
      }
    }, children.map(ch => /*#__PURE__*/React.createElement("div", {
      key: ch.id,
      style: {
        padding: "6px 20px 6px 0",
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: 8,
        background: ch.color
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        color: "var(--ink-2)"
      }
    }, ch.name)))));
  })), tab === "rules" && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr auto" : "auto 1fr auto auto auto auto",
      gap: 12,
      padding: "10px 20px",
      background: "var(--paper-2)",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".08em",
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Prio."), /*#__PURE__*/React.createElement("span", null, "Motif"), !isMobile && /*#__PURE__*/React.createElement("span", null, "Type"), !isMobile && /*#__PURE__*/React.createElement("span", null, "Cible"), !isMobile && /*#__PURE__*/React.createElement("span", null, "Port\xE9e"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: "right"
    }
  }, "Hits")), RULES.map(r => {
    const cat = findCat(r.categoryId);
    return /*#__PURE__*/React.createElement("div", {
      key: r.id,
      style: {
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr auto" : "auto 1fr auto auto auto auto",
        gap: 12,
        padding: "12px 20px",
        alignItems: "center",
        borderTop: "1px solid var(--hairline)"
      }
    }, !isMobile && /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        fontSize: 12,
        color: "var(--ink-3)"
      }
    }, r.priority), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        color: "var(--ink)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, r.pattern), isMobile && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-3)",
        marginTop: 2
      }
    }, labelMatch(r.matchType), " \xB7 ", cat.name)), !isMobile && /*#__PURE__*/React.createElement(Pill, {
      tone: "neutral"
    }, labelMatch(r.matchType)), !isMobile && /*#__PURE__*/React.createElement(CategoryChip, {
      category: cat,
      size: "sm"
    }), !isMobile && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--ink-3)"
      }
    }, r.scope === "group" ? "Foyer" : "Perso"), /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        fontSize: 12.5,
        color: "var(--ink-2)",
        textAlign: "right"
      }
    }, r.hits));
  })));
};
const labelMatch = m => ({
  CONTAINS: "Contient",
  REGEX: "Regex",
  EXACT: "Égal",
  STARTS_WITH: "Commence par"
})[m];

// ============== LINKS ============================================
const LinksScreen = ({
  device
}) => {
  const isMobile = device === "mobile";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? 16 : 32,
      paddingBottom: isMobile ? 96 : 32
    }
  }, !isMobile && /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "R\xE9conciliation"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32
    }
  }, "Liens de transactions"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--ink-3)",
      fontSize: 13.5,
      marginTop: 4
    }
  }, "Lier les remboursements et virements internes pour ne pas les compter deux fois.")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "link",
    size: "sm"
  }, "Mode liaison")), /*#__PURE__*/React.createElement(SectionHeaderInline, {
    title: "Suggestions",
    sub: `${LINK_SUGGESTIONS.length} paire(s) détectée(s)`
  }), LINK_SUGGESTIONS.map(s => {
    const a = TRANSACTIONS.find(t => t.id === s.txA);
    const b = TRANSACTIONS.find(t => t.id === s.txB);
    return /*#__PURE__*/React.createElement(Card, {
      key: s.id,
      padding: 18,
      style: {
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "between",
      style: {
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement(Pill, {
      tone: "info",
      dot: true
    }, "Confiance ", Math.round(s.confidence * 100), " %"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm"
    }, "Ignorer"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "sm",
      icon: "link"
    }, "Lier"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr auto 1fr",
        gap: 12,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement(TxMiniCard, {
      tx: a
    }), !isMobile && /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ink-3)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "link",
      size: 20
    })), /*#__PURE__*/React.createElement(TxMiniCard, {
      tx: b
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        fontSize: 11.5,
        color: "var(--ink-3)"
      }
    }, "\xC9cart : ", /*#__PURE__*/React.createElement("span", {
      className: "num"
    }, s.gap), " \xB7 Total net ", /*#__PURE__*/React.createElement("span", {
      className: "num"
    }, "0,00 \u20AC"), " \u2192 groupe \xE9quilibr\xE9"));
  }), /*#__PURE__*/React.createElement(SectionHeaderInline, {
    title: "Liens existants",
    sub: `${EXISTING_LINKS.length} groupe(s)`
  }), EXISTING_LINKS.map(l => /*#__PURE__*/React.createElement(Card, {
    key: l.id,
    padding: 18,
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 16
  }), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, l.name), l.balanced && /*#__PURE__*/React.createElement(Pill, {
    tone: "success",
    dot: true
  }, "\xC9quilibr\xE9 \xB7 exclu des totaux")), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, "Dissocier")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, l.members.map(m => /*#__PURE__*/React.createElement(TxMiniCard, {
    key: m,
    tx: TRANSACTIONS.find(t => t.id === m)
  }))))));
};
const SectionHeaderInline = ({
  title,
  sub
}) => /*#__PURE__*/React.createElement("div", {
  className: "between",
  style: {
    marginTop: 18,
    marginBottom: 12,
    alignItems: "baseline"
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "serif",
  style: {
    fontSize: 22
  }
}, title), /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 12,
    color: "var(--ink-3)"
  }
}, sub));
const TxMiniCard = ({
  tx
}) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      background: "var(--paper-2)",
      borderRadius: 10,
      border: "1px solid var(--hairline)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
      background: cat.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--ink)"
    }
  }, tx.label)), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 13.5,
      fontWeight: 500,
      color: tx.amount > 0 ? "var(--income)" : "var(--ink)"
    }
  }, fmtEUR(tx.amount, {
    sign: tx.amount > 0
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)",
      marginTop: 4
    }
  }, fmtDate(tx.date), " \xB7 ", acc?.name, " \xB7 ", cat.name));
};

// ============== GROUPS ===========================================
const GroupsScreen = ({
  device
}) => {
  const isMobile = device === "mobile";
  const ctx = React.useContext(window.AppContext);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? 16 : 32,
      paddingBottom: isMobile ? 96 : 32
    }
  }, !isMobile && /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "Partage"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32
    }
  }, "Foyer Dupont"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--ink-3)",
      fontSize: 13.5,
      marginTop: 4
    }
  }, "2 membres \xB7 2 comptes partag\xE9s \xB7 1 budget commun")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus",
    size: "sm",
    onClick: () => ctx.setModal("inviteMember")
  }, "Inviter un membre")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      padding: "16px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, "Membres"), /*#__PURE__*/React.createElement(Pill, {
    tone: "primary",
    soft: true
  }, HOUSEHOLD.members.length, " actifs")), HOUSEHOLD.members.map(m => /*#__PURE__*/React.createElement("div", {
    key: m.id,
    style: {
      padding: "14px 20px",
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: m.initials,
    size: 36
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--ink)"
    }
  }, m.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, m.id === "u_pierre" ? "pierre.dupont@example.fr" : "claire.dupont@example.fr")), /*#__PURE__*/React.createElement(Pill, {
    tone: m.role === "OWNER" ? "primary" : "neutral"
  }, m.role), /*#__PURE__*/React.createElement("button", {
    style: {
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "more",
    size: 16
  })))), HOUSEHOLD.pending.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: "14px 20px",
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      alignItems: "center",
      gap: 12,
      background: "var(--paper-2)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 36,
      height: 36,
      borderRadius: 36,
      border: "1px dashed var(--hairline-2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "mail",
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-2)"
    }
  }, p.email), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, "Invitation envoy\xE9e ", p.invitedAt)), /*#__PURE__*/React.createElement(Pill, {
    tone: "warning",
    dot: true
  }, "En attente")))), /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Comptes partag\xE9s"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      marginBottom: 16
    }
  }, ACCOUNTS.filter(a => a.sharedWith.length).map(a => /*#__PURE__*/React.createElement("div", {
    key: a.id,
    className: "row",
    style: {
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 24,
      borderRadius: 3,
      background: a.color
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--ink)"
    }
  }, a.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, a.permission === "WRITE" ? "Lecture + écriture" : "Lecture seule")), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, fmtEURcompact(a.balance))))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--hairline)",
      marginBottom: 14
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Budgets communs"), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 10,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 24,
      borderRadius: 3,
      background: "var(--cat-housing)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--ink)"
    }
  }, "Foyer \u2014 mai"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, "1 369 \u20AC / 1 380 \u20AC")), /*#__PURE__*/React.createElement(Pill, {
    tone: "success",
    dot: true
  }, "OK")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    full: true,
    icon: "plus",
    onClick: () => ctx.setModal("inviteMember")
  }, "Inviter un membre")))));
};
Object.assign(window, {
  BudgetsScreen,
  AccountsScreen,
  CategoriesScreen,
  LinksScreen,
  GroupsScreen
});