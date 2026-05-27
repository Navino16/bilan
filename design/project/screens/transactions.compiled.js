/* Transactions screen with detail panel + create-rule dialog */

const TransactionsScreen = ({
  device,
  monthIdx,
  density = "cozy",
  scope
}) => {
  const isMobile = device === "mobile";
  const [selectedId, setSelectedId] = React.useState("t06"); // pre-selected for prototype
  const [showRuleDialog, setShowRuleDialog] = React.useState(false);
  const [filterCat, setFilterCat] = React.useState("all");
  const [filterType, setFilterType] = React.useState("all");
  let txs = TRANSACTIONS.filter(t => t.date.startsWith("2026-05"));
  if (filterCat !== "all") txs = txs.filter(t => t.categoryId === filterCat);
  if (filterType === "in") txs = txs.filter(t => t.amount > 0);
  if (filterType === "out") txs = txs.filter(t => t.amount < 0);
  const grouped = groupByDay(txs);
  const selected = txs.find(t => t.id === selectedId) || TRANSACTIONS.find(t => t.id === selectedId);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: "100%",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      overflow: "auto"
    },
    className: "scrollbar"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? "16px 16px 12px" : "32px 32px 16px"
    }
  }, !isMobile && /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "Mai 2026 \xB7 ", txs.length, " op\xE9rations"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32,
      lineHeight: 1.1
    }
  }, "Transactions")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "filter",
    size: "sm"
  }, "Filtres"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "download",
    size: "sm"
  }, "Exporter"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus",
    size: "sm"
  }, "Saisir"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "all",
      label: "Toutes"
    }, {
      id: "in",
      label: "Entrées"
    }, {
      id: "out",
      label: "Sorties"
    }],
    active: filterType,
    onChange: setFilterType
  }), !isMobile && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      height: 18,
      background: "var(--hairline)",
      margin: "0 4px"
    }
  }), /*#__PURE__*/React.createElement(CategoryFilter, {
    value: filterCat,
    onChange: setFilterCat
  }), /*#__PURE__*/React.createElement(Pill, {
    tone: "neutral"
  }, "28 r\xE9sultats"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "sort"
  }, "Trier \xB7 Date \u2193")))), /*#__PURE__*/React.createElement("div", null, !isMobile && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "auto 1fr auto auto auto auto",
      gap: 12,
      padding: "10px 32px",
      borderTop: "1px solid var(--hairline)",
      borderBottom: "1px solid var(--hairline)",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".08em",
      color: "var(--ink-3)",
      background: "var(--paper-2)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Date"), /*#__PURE__*/React.createElement("span", null, "Libell\xE9"), /*#__PURE__*/React.createElement("span", null, "Cat\xE9gorie"), /*#__PURE__*/React.createElement("span", null, "Compte"), /*#__PURE__*/React.createElement("span", null, "Type"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: "right"
    }
  }, "Montant")), grouped.map(group => /*#__PURE__*/React.createElement("div", {
    key: group.date
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? "12px 16px 6px" : "12px 32px 8px",
      fontSize: 11.5,
      color: "var(--ink-3)",
      textTransform: "capitalize",
      letterSpacing: ".02em",
      background: "var(--paper)",
      position: "sticky",
      top: 0,
      zIndex: 2,
      borderBottom: "1px solid var(--hairline)",
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", null, fmtDateLong(group.date)), /*#__PURE__*/React.createElement("span", {
    className: "num"
  }, fmtEUR(group.total, {
    sign: group.total > 0
  }))), group.txs.map(t => /*#__PURE__*/React.createElement(TxRowFull, {
    key: t.id,
    tx: t,
    density: density,
    selected: t.id === selectedId,
    compact: isMobile,
    onClick: () => setSelectedId(t.id)
  })))))), !isMobile && selected && /*#__PURE__*/React.createElement(TxDetail, {
    tx: selected,
    onClose: () => setSelectedId(null),
    onChangeCategory: () => setShowRuleDialog(true)
  }), isMobile && selected && /*#__PURE__*/React.createElement(TxDetailMobile, {
    tx: selected,
    onClose: () => setSelectedId(null),
    onChangeCategory: () => setShowRuleDialog(true)
  }), showRuleDialog && /*#__PURE__*/React.createElement(RuleSuggestionDialog, {
    tx: selected,
    onClose: () => setShowRuleDialog(false)
  }));
};

// ---- Density picker ----
const DensityPicker = () => {
  const [d, setD] = React.useState(document.documentElement.getAttribute("data-density") || "cozy");
  const set = v => {
    setD(v);
    document.documentElement.setAttribute("data-density", v);
  };
  return /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "compact",
      label: "Dense"
    }, {
      id: "cozy",
      label: "Confort"
    }, {
      id: "roomy",
      label: "Spacieux"
    }],
    active: d,
    onChange: set
  });
};
const CategoryFilter = ({
  value,
  onChange
}) => {
  const [open, setOpen] = React.useState(false);
  const current = value === "all" ? "Toutes catégories" : findCat(value)?.name;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpen(!open),
    style: {
      height: 30,
      padding: "0 10px",
      background: "var(--card)",
      border: "1px solid var(--hairline)",
      borderRadius: 7,
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12.5,
      color: "var(--ink-2)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "tag",
    size: 13
  }), " ", current, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 12
  })), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 34,
      left: 0,
      minWidth: 180,
      background: "var(--card)",
      border: "1px solid var(--hairline)",
      borderRadius: 10,
      padding: 4,
      boxShadow: "var(--shadow-2)",
      zIndex: 50,
      maxHeight: 320,
      overflow: "auto"
    },
    className: "scrollbar"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      onChange("all");
      setOpen(false);
    },
    style: dropItem(value === "all")
  }, "Toutes cat\xE9gories"), CATEGORIES.filter(c => !c.parentId).map(c => /*#__PURE__*/React.createElement("button", {
    key: c.id,
    onClick: () => {
      onChange(c.id);
      setOpen(false);
    },
    style: dropItem(value === c.id)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
      background: c.color
    }
  }), " ", c.name))));
};
const dropItem = active => ({
  width: "100%",
  padding: "7px 8px",
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: active ? "var(--paper-2)" : "transparent",
  borderRadius: 6,
  fontSize: 13,
  color: "var(--ink)",
  textAlign: "left"
});

// --- Row -----------------------------------------------------------
const TxRowFull = ({
  tx,
  density,
  selected,
  compact,
  onClick
}) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  const py = density === "compact" ? 6 : density === "roomy" ? 14 : 10;
  if (compact) {
    return /*#__PURE__*/React.createElement("button", {
      onClick: onClick,
      style: {
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "10px 16px",
        borderBottom: "1px solid var(--hairline)",
        background: selected ? "var(--paper-2)" : "transparent",
        textAlign: "left"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 30,
        height: 30,
        borderRadius: 8,
        background: cat.color,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        opacity: 0.92
      }
    }, cat.icon), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13.5,
        color: "var(--ink)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, tx.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: "var(--ink-3)"
      }
    }, cat.name, " \xB7 ", acc?.name)), /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        fontSize: 14,
        fontWeight: 500,
        color: tx.amount > 0 ? "var(--income)" : "var(--ink)"
      }
    }, fmtEUR(tx.amount, {
      sign: tx.amount > 0
    })));
  }
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      width: "100%",
      display: "grid",
      gridTemplateColumns: "70px 1fr 200px 160px 90px 130px",
      gap: 12,
      alignItems: "center",
      padding: `${py}px 32px`,
      borderBottom: "1px solid var(--hairline)",
      background: selected ? "var(--primary-soft)" : "transparent",
      textAlign: "left",
      transition: "background .12s ease"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 12.5,
      color: "var(--ink-3)"
    }
  }, fmtDate(tx.date)), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      height: 26,
      borderRadius: 6,
      flexShrink: 0,
      background: cat.color,
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      opacity: 0.92
    }
  }, cat.icon), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: selected ? "var(--ink)" : "var(--ink)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, tx.label, tx.linked && /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 11
  })), density === "roomy" && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, tx.rawLabel))), /*#__PURE__*/React.createElement(CategoryChip, {
    category: cat,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-3)"
    }
  }, acc?.name), /*#__PURE__*/React.createElement(Pill, {
    tone: "neutral",
    style: {
      height: 20,
      fontSize: 10.5
    }
  }, labelType(tx.type)), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 14,
      textAlign: "right",
      fontWeight: 500,
      color: tx.amount > 0 ? "var(--income)" : "var(--ink)"
    }
  }, fmtEUR(tx.amount, {
    sign: tx.amount > 0
  })));
};
const labelType = t => ({
  CARD: "Carte",
  TRANSFER: "Virement",
  DIRECT_DEBIT: "Prélèvement",
  CHEQUE: "Chèque",
  ATM: "Retrait"
})[t] || "Autre";

// --- Group by day -------------------------------------------------
const groupByDay = txs => {
  const m = new Map();
  for (const t of txs) {
    if (!m.has(t.date)) m.set(t.date, []);
    m.get(t.date).push(t);
  }
  return [...m.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1).map(([date, txs]) => ({
    date,
    txs,
    total: txs.reduce((s, t) => s + t.amount, 0)
  }));
};

// --- Detail panel (desktop) ---------------------------------------
const TxDetail = ({
  tx,
  onClose,
  onChangeCategory
}) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 380,
      flexShrink: 0,
      borderLeft: "1px solid var(--hairline)",
      background: "var(--card-2)",
      overflow: "auto"
    },
    className: "scrollbar"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24,
      borderBottom: "1px solid var(--hairline)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "Transaction"), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: "num serif",
    style: {
      fontSize: 36,
      color: tx.amount > 0 ? "var(--income)" : "var(--ink)",
      lineHeight: 1,
      marginBottom: 6
    }
  }, fmtEUR(tx.amount, {
    sign: tx.amount > 0
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--ink)"
    }
  }, tx.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-3)",
      marginTop: 2
    }
  }, fmtDateLong(tx.date))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24,
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Cat\xE9gorie"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onChangeCategory,
    style: {
      width: "100%",
      padding: "10px 12px",
      background: "var(--card)",
      border: "1px solid var(--hairline-2)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 13.5
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
      flex: 1,
      textAlign: "left"
    }
  }, cat.name), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 14
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Compte"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      padding: "10px 12px",
      background: "var(--card)",
      border: "1px solid var(--hairline-2)",
      borderRadius: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
      background: acc.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5
    }
  }, acc.name), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, acc.bank))), /*#__PURE__*/React.createElement(Field, {
    label: "Type"
  }, /*#__PURE__*/React.createElement(Pill, {
    tone: "neutral"
  }, labelType(tx.type))), /*#__PURE__*/React.createElement(Field, {
    label: "Libell\xE9 d'origine"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      background: "var(--paper-2)",
      border: "1px solid var(--hairline)",
      borderRadius: 8,
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--ink-2)"
    }
  }, tx.rawLabel)), /*#__PURE__*/React.createElement(Field, {
    label: "Note"
  }, /*#__PURE__*/React.createElement("textarea", {
    defaultValue: tx.note,
    placeholder: "Ajouter une note priv\xE9e\u2026",
    style: {
      width: "100%",
      minHeight: 60,
      padding: "10px 12px",
      background: "var(--card)",
      border: "1px solid var(--hairline-2)",
      borderRadius: 8,
      fontSize: 13.5,
      fontFamily: "var(--font-sans)",
      color: "var(--ink)",
      resize: "vertical",
      outline: "none"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--hairline)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "Actions"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(ActionRow, {
    icon: "link",
    label: "Lier \xE0 une autre transaction"
  }), /*#__PURE__*/React.createElement(ActionRow, {
    icon: "target",
    label: "Affecter \xE0 un budget"
  }), /*#__PURE__*/React.createElement(ActionRow, {
    icon: "external",
    label: "Voir l'import d'origine"
  }), /*#__PURE__*/React.createElement(ActionRow, {
    icon: "trash",
    label: "Supprimer",
    danger: true
  }))));
};
const Field = ({
  label,
  children
}) => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
  className: "overline",
  style: {
    marginBottom: 6
  }
}, label), children);
const ActionRow = ({
  icon,
  label,
  danger
}) => /*#__PURE__*/React.createElement("button", {
  style: {
    width: "100%",
    padding: "10px 12px",
    background: "transparent",
    border: "1px solid var(--hairline)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: danger ? "var(--expense)" : "var(--ink-2)",
    textAlign: "left"
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: icon,
  size: 15
}), label, /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement(Icon, {
  name: "chevron-right",
  size: 14
}));

// --- Detail (mobile bottom sheet) --------------------------------
const TxDetailMobile = ({
  tx,
  onClose,
  onChangeCategory
}) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "rgba(20,17,13,.35)",
      display: "flex",
      alignItems: "flex-end",
      zIndex: 20
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: "100%",
      maxHeight: "85%",
      background: "var(--card)",
      borderRadius: "20px 20px 0 0",
      padding: 20,
      overflow: "auto"
    },
    className: "scrollbar"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 36,
      height: 4,
      borderRadius: 4,
      background: "var(--hairline-2)",
      margin: "0 auto 14px"
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "num serif",
    style: {
      fontSize: 32,
      color: tx.amount > 0 ? "var(--income)" : "var(--ink)"
    }
  }, fmtEUR(tx.amount, {
    sign: tx.amount > 0
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--ink)",
      marginTop: 4
    }
  }, tx.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-3)",
      marginBottom: 16
    }
  }, fmtDateLong(tx.date)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Cat\xE9gorie"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onChangeCategory,
    style: {
      width: "100%",
      padding: "10px 12px",
      background: "var(--paper-2)",
      border: "1px solid var(--hairline)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 13.5
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
      flex: 1,
      textAlign: "left"
    }
  }, cat.name), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 14
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Compte"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13
    }
  }, acc.name, " \xB7 ", acc.bank)), /*#__PURE__*/React.createElement(Field, {
    label: "Libell\xE9 d'origine"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--ink-2)"
    }
  }, tx.rawLabel)))));
};

// --- Create rule dialog ------------------------------------------
const RuleSuggestionDialog = ({
  tx,
  onClose
}) => {
  const cat = findCat(tx.categoryId);
  const token = tx.rawLabel.split(/\s+/).find(t => t.length >= 4) || tx.rawLabel.split(/\s+/)[0];
  const [match, setMatch] = React.useState("CONTAINS");
  const [scope, setScope] = React.useState("user");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "rgba(20,17,13,.45)",
      backdropFilter: "blur(2px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 30,
      padding: 24
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: "var(--card)",
      border: "1px solid var(--hairline)",
      borderRadius: 16,
      width: 440,
      maxWidth: "100%",
      boxShadow: "var(--shadow-3)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 24px 12px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Apprentissage"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 24,
      lineHeight: 1.2,
      color: "var(--ink)"
    }
  }, "Cr\xE9er une r\xE8gle pour les transactions similaires\u202F?"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      color: "var(--ink-3)",
      fontSize: 13
    }
  }, "Vous venez de classer ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--ink)"
    }
  }, "\xAB ", tx.label, " \xBB"), " dans ", /*#__PURE__*/React.createElement(CategoryChip, {
    category: cat,
    size: "sm"
  }), ". Bilan peut classer automatiquement les futures transactions correspondantes.")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 24px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Motif"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      background: "var(--paper-2)",
      borderRadius: 8,
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      color: "var(--ink)",
      border: "1px dashed var(--hairline-2)"
    }
  }, token)), /*#__PURE__*/React.createElement(Field, {
    label: "Type de correspondance"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "CONTAINS",
      label: "Contient"
    }, {
      id: "STARTS_WITH",
      label: "Commence par"
    }, {
      id: "EXACT",
      label: "Égal à"
    }, {
      id: "REGEX",
      label: "Regex"
    }],
    active: match,
    onChange: setMatch
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Port\xE9e"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "user",
      label: "Mes données seulement"
    }, {
      id: "group",
      label: "Foyer Dupont"
    }],
    active: scope,
    onChange: setScope
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      background: "var(--info-bg)",
      borderRadius: 8,
      fontSize: 12.5,
      color: "var(--info)",
      display: "flex",
      gap: 8,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "4 transactions"), " existantes correspondent. Elles ne seront pas reclass\xE9es automatiquement."))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 24px",
      background: "var(--paper)",
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      justifyContent: "flex-end",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: onClose
  }, "Non, merci"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "check"
  }, "Cr\xE9er la r\xE8gle"))));
};
Object.assign(window, {
  TransactionsScreen
});