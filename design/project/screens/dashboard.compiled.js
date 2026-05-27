/* Dashboard — flagship screen */

const DashboardScreen = ({
  device,
  monthIdx,
  layout = "editorial",
  budgetViz = "bar",
  scope
}) => {
  const totals = monthTotals();
  const spending = spendingByCategory();
  const daily = dailySpend();
  const isMobile = device === "mobile";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? 16 : 32,
      paddingBottom: isMobile ? 96 : 32
    }
  }, !isMobile && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      marginBottom: 28
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Vue d'ensemble \xB7 ", scope === "household" ? "Foyer Dupont" : "Pierre Dupont"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 44,
      lineHeight: 1,
      letterSpacing: "-.015em"
    }
  }, "Mai 2026"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--ink-3)",
      marginTop: 8,
      fontSize: 13.5
    }
  }, "26 mai \xB7 semaine 21 \xB7 ", TRANSACTIONS.filter(t => t.date.startsWith("2026-05")).length, " transactions")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Pill, {
    tone: "primary",
    soft: true,
    dot: true
  }, "Mois en cours"), /*#__PURE__*/React.createElement(Pill, {
    tone: "neutral"
  }, "Cl\xF4ture le 31 mai"))), isMobile && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "Mai 2026 \xB7 solde net"), /*#__PURE__*/React.createElement("div", {
    className: "serif num",
    style: {
      fontSize: 40,
      lineHeight: 1,
      color: totals.net >= 0 ? "var(--income)" : "var(--expense)"
    }
  }, fmtEUR(totals.net, {
    sign: true,
    decimals: 0
  }))), /*#__PURE__*/React.createElement(KPIRow, {
    totals: totals,
    isMobile: isMobile
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: isMobile ? 20 : 28,
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : layout === "split" ? "1fr 1fr" : "1.4fr 1fr",
      gap: isMobile ? 16 : 20
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: isMobile ? 18 : 24
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "R\xE9partition"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 20,
      marginTop: 2
    }
  }, "D\xE9penses par cat\xE9gorie")), /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "m",
      label: "Mois"
    }, {
      id: "q",
      label: "Trim."
    }, {
      id: "y",
      label: "Année"
    }],
    active: "m",
    onChange: () => {}
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      alignItems: "center",
      gap: isMobile ? 16 : 24
    }
  }, /*#__PURE__*/React.createElement(Donut, {
    size: isMobile ? 180 : 220,
    thickness: isMobile ? 22 : 26,
    data: spending.map(s => ({
      value: s.amount,
      color: s.category.color
    })),
    centerLabel: fmtEURcompact(totals.expense),
    centerSub: "d\xE9pens\xE9s ce mois"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      width: "100%"
    }
  }, spending.slice(0, 6).map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 10,
      background: s.category.color,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      color: "var(--ink)"
    }
  }, s.category.name), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 13,
      color: "var(--ink-2)"
    }
  }, fmtEURcompact(s.amount)), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      width: 38,
      textAlign: "right",
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, Math.round(s.amount / totals.expense * 100), " %")))))), /*#__PURE__*/React.createElement(Card, {
    padding: isMobile ? 18 : 24
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "Quotidien"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 20,
      marginTop: 2
    }
  }, "D\xE9penses jour par jour")), /*#__PURE__*/React.createElement(Pill, {
    tone: "warning",
    dot: true
  }, "Pic le 21")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(MiniBars, {
    points: daily.slice(0, 26),
    width: isMobile ? 320 : 380,
    height: isMobile ? 80 : 100,
    color: "var(--ink-2)",
    highlightLast: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      fontSize: 11,
      color: "var(--ink-3)",
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("span", null, "1 mai"), /*#__PURE__*/React.createElement("span", null, "10"), /*#__PURE__*/React.createElement("span", null, "20"), /*#__PURE__*/React.createElement("span", null, "aujourd'hui")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      paddingTop: 16,
      borderTop: "1px solid var(--hairline)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Stat, {
    label: "Moy. / jour",
    value: fmtEURcompact(totals.expense / 26)
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Plus gros jour",
    value: fmtEURcompact(1240),
    sub: "21 mai \xB7 Loyer"
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: isMobile ? 16 : 20,
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr 1.2fr",
      gap: isMobile ? 16 : 20
    }
  }, /*#__PURE__*/React.createElement(BudgetSnapshot, {
    viz: budgetViz,
    isMobile: isMobile
  }), /*#__PURE__*/React.createElement(RecentTransactions, {
    isMobile: isMobile
  })), !isMobile && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20,
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(AccountsStrip, null), /*#__PURE__*/React.createElement(UpcomingStrip, null), /*#__PURE__*/React.createElement(HouseholdStrip, null)), isMobile && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(AccountsStrip, null)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(UpcomingStrip, null))));
};

// ---------- KPI row ------------------------------------------------
const KPIRow = ({
  totals,
  isMobile
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
    gap: isMobile ? 10 : 14
  }
}, /*#__PURE__*/React.createElement(KPI, {
  label: "Revenus",
  value: fmtEURcompact(totals.income),
  sub: "\u2197 +2,1 % vs avril",
  tone: "success",
  big: !isMobile
}), /*#__PURE__*/React.createElement(KPI, {
  label: "D\xE9penses",
  value: fmtEURcompact(totals.expense),
  sub: "\u2197 +8,4 % vs avril",
  tone: "danger",
  big: !isMobile
}), /*#__PURE__*/React.createElement(KPI, {
  label: "\xC9pargne",
  value: fmtEURcompact(totals.saved),
  sub: "Virement automatique",
  tone: "primary",
  big: !isMobile
}), /*#__PURE__*/React.createElement(KPI, {
  label: "Solde net",
  value: fmtEUR(totals.net, {
    sign: true,
    decimals: 0
  }),
  sub: "Disponible fin de mois",
  tone: totals.net >= 0 ? "success" : "danger",
  big: !isMobile
}));
const KPI = ({
  label,
  value,
  sub,
  tone,
  big
}) => {
  const color = {
    success: "var(--income)",
    danger: "var(--expense)",
    primary: "var(--primary)"
  }[tone] || "var(--ink)";
  return /*#__PURE__*/React.createElement(Card, {
    padding: big ? 20 : 14,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: big ? 8 : 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "num serif",
    style: {
      fontSize: big ? 30 : 22,
      lineHeight: 1,
      color,
      letterSpacing: "-.01em"
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, sub));
};
const Stat = ({
  label,
  value,
  sub
}) => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
  className: "overline",
  style: {
    marginBottom: 2
  }
}, label), /*#__PURE__*/React.createElement("div", {
  className: "num",
  style: {
    fontSize: 18,
    color: "var(--ink)",
    fontWeight: 500
  }
}, value), sub && /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 11,
    color: "var(--ink-3)"
  }
}, sub));

// ---------- Budget snapshot ---------------------------------------
const BudgetSnapshot = ({
  viz,
  isMobile
}) => {
  const b = BUDGETS[0];
  const lines = b.lines;
  return /*#__PURE__*/React.createElement(Card, {
    padding: isMobile ? 18 : 24
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "Mai 2026"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 20,
      marginTop: 2
    }
  }, "Mon budget")), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconRight: "chevron-right"
  }, "D\xE9tail")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, lines.slice(0, 5).map(l => {
    const cat = findCat(l.categoryId);
    const ratio = l.spent / l.planned;
    const over = ratio > 1;
    return /*#__PURE__*/React.createElement("div", {
      key: l.id
    }, /*#__PURE__*/React.createElement("div", {
      className: "between",
      style: {
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
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
    }, cat.name), over && /*#__PURE__*/React.createElement(Pill, {
      tone: "danger",
      soft: false,
      style: {
        height: 18,
        fontSize: 10.5
      }
    }, "D\xE9pass\xE9")), /*#__PURE__*/React.createElement("div", {
      className: "num",
      style: {
        fontSize: 12.5,
        color: over ? "var(--expense)" : "var(--ink-2)"
      }
    }, fmtEURcompact(l.spent), " ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--ink-3)"
      }
    }, "/ ", fmtEURcompact(l.planned)))), viz === "bar" && /*#__PURE__*/React.createElement(BudgetBar, {
      spent: l.spent,
      planned: l.planned
    }), viz === "gauge" && /*#__PURE__*/React.createElement(BudgetGauge, {
      spent: l.spent,
      planned: l.planned,
      color: cat.color
    }), viz === "ring" && /*#__PURE__*/React.createElement(BudgetRingLine, {
      spent: l.spent,
      planned: l.planned,
      color: cat.color
    }), viz === "spark" && /*#__PURE__*/React.createElement(BudgetSpark, {
      spent: l.spent,
      planned: l.planned,
      color: cat.color
    }));
  })));
};
const BudgetGauge = ({
  spent,
  planned,
  color
}) => {
  const ratio = Math.min(1.3, spent / planned);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: 18,
      gap: 2
    }
  }, Array.from({
    length: 14
  }).map((_, i) => {
    const filled = i / 14 < Math.min(1, ratio);
    const over = i / 14 < ratio && i / 14 >= 1;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        flex: 1,
        background: over ? "var(--expense)" : filled ? color : "var(--paper-2)",
        borderRadius: 2
      }
    });
  }));
};
const BudgetRingLine = ({
  spent,
  planned,
  color
}) => {
  const ratio = Math.min(1, spent / planned);
  const C = 2 * Math.PI * 9;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "24",
    height: "24",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9",
    stroke: "var(--paper-2)",
    strokeWidth: "3",
    fill: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9",
    stroke: spent > planned ? "var(--expense)" : color,
    strokeWidth: "3",
    fill: "none",
    strokeDasharray: `${ratio * C} ${C}`,
    strokeLinecap: "round",
    transform: "rotate(-90 12 12)"
  })), /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, Math.round(spent / planned * 100), " %"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }));
};
const BudgetSpark = ({
  spent,
  planned,
  color
}) => {
  const days = [12, 8, 14, 6, 22, 18, 30, 15, 25, 20].slice(0, 10);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Sparkline, {
    points: days,
    width: 200,
    height: 28,
    color: spent > planned ? "var(--expense)" : color,
    fill: "transparent"
  })), /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, Math.round(spent / planned * 100), " %"));
};

// ---------- Recent transactions -----------------------------------
const RecentTransactions = ({
  isMobile
}) => {
  const txs = TRANSACTIONS.slice(0, isMobile ? 6 : 8);
  return /*#__PURE__*/React.createElement(Card, {
    padding: isMobile ? 0 : 0
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      padding: isMobile ? "16px 18px 8px" : "20px 24px 8px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "R\xE9cent"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 20,
      marginTop: 2
    }
  }, "Derni\xE8res op\xE9rations")), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconRight: "chevron-right"
  }, "Tout voir")), /*#__PURE__*/React.createElement("div", null, txs.map(t => /*#__PURE__*/React.createElement(TxRow, {
    key: t.id,
    tx: t,
    compact: isMobile
  }))));
};
const TxRow = ({
  tx,
  compact
}) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: compact ? "1fr auto" : "auto 1fr auto auto",
      gap: 12,
      alignItems: "center",
      padding: compact ? "10px 18px" : "10px 24px",
      borderTop: "1px solid var(--hairline)"
    }
  }, !compact && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 8,
      background: cat.color,
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 14,
      fontWeight: 500,
      opacity: 0.92
    }
  }, cat.icon), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      color: "var(--ink)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, tx.label), tx.linked && /*#__PURE__*/React.createElement("span", {
    title: "Li\xE9e",
    style: {
      color: "var(--ink-3)",
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 12
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, fmtDate(tx.date)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      height: 3,
      borderRadius: 3,
      background: "var(--ink-4)"
    }
  }), !compact && /*#__PURE__*/React.createElement(CategoryChip, {
    category: cat,
    size: "sm"
  }), compact && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, cat.name))), !compact && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, acc?.name), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: compact ? 14 : 14.5,
      fontWeight: 500,
      color: tx.amount > 0 ? "var(--income)" : "var(--ink)",
      letterSpacing: "-.01em"
    }
  }, fmtEUR(tx.amount, {
    sign: tx.amount > 0
  })));
};

// ---------- Accounts strip ----------------------------------------
const AccountsStrip = () => /*#__PURE__*/React.createElement(Card, {
  padding: 20
}, /*#__PURE__*/React.createElement("div", {
  className: "between",
  style: {
    marginBottom: 12
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "overline"
}, "Comptes"), /*#__PURE__*/React.createElement(Button, {
  variant: "ghost",
  size: "sm",
  iconRight: "chevron-right"
}, "G\xE9rer")), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    flexDirection: "column",
    gap: 8
  }
}, ACCOUNTS.slice(0, 4).map(a => /*#__PURE__*/React.createElement("div", {
  key: a.id,
  style: {
    display: "flex",
    alignItems: "center",
    gap: 10
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 6,
    height: 28,
    borderRadius: 3,
    background: a.color
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    minWidth: 0
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
}, a.bank)), /*#__PURE__*/React.createElement("div", {
  className: "num",
  style: {
    fontSize: 14,
    color: a.balance < 0 ? "var(--expense)" : "var(--ink)",
    fontWeight: 500
  }
}, fmtEURcompact(a.balance))))));

// ---------- Upcoming strip ----------------------------------------
const UpcomingStrip = () => {
  const items = [{
    label: "Loyer juin",
    due: "1 juin",
    amount: -1240,
    cat: "c_rent"
  }, {
    label: "EDF",
    due: "5 juin",
    amount: -129,
    cat: "c_energy"
  }, {
    label: "Salaire",
    due: "15 juin",
    amount: 2980,
    cat: "c_salary"
  }, {
    label: "Netflix",
    due: "24 juin",
    amount: -18.90,
    cat: "c_bills"
  }];
  return /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "\xC0 venir"), /*#__PURE__*/React.createElement(Pill, {
    tone: "info",
    soft: true
  }, "4 pr\xE9l\xE8vements")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, items.map((it, i) => {
    const cat = findCat(it.cat);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 6,
        height: 28,
        borderRadius: 3,
        background: cat.color
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: "var(--ink)"
      }
    }, it.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-3)"
      }
    }, it.due)), /*#__PURE__*/React.createElement("div", {
      className: "num",
      style: {
        fontSize: 13.5,
        color: it.amount > 0 ? "var(--income)" : "var(--ink-2)",
        fontWeight: 500
      }
    }, fmtEUR(it.amount, {
      sign: it.amount > 0,
      decimals: 0
    })));
  })));
};

// ---------- Household strip ---------------------------------------
const HouseholdStrip = () => /*#__PURE__*/React.createElement(Card, {
  padding: 20
}, /*#__PURE__*/React.createElement("div", {
  className: "between",
  style: {
    marginBottom: 12
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "overline"
}, "Foyer Dupont"), /*#__PURE__*/React.createElement(Button, {
  variant: "ghost",
  size: "sm",
  iconRight: "chevron-right"
}, "Foyer")), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    flexDirection: "column",
    gap: 10
  }
}, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
  className: "num serif",
  style: {
    fontSize: 22,
    color: "var(--ink)"
  }
}, fmtEUR(1369, {
  decimals: 0
})), /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 11.5,
    color: "var(--ink-3)"
  }
}, "d\xE9penses partag\xE9es ce mois")), /*#__PURE__*/React.createElement(BudgetBar, {
  spent: 1369,
  planned: 1380,
  height: 6
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    gap: -6,
    marginTop: 8
  }
}, HOUSEHOLD.members.map((m, i) => /*#__PURE__*/React.createElement("div", {
  key: m.id,
  style: {
    marginLeft: i === 0 ? 0 : -8
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  initials: m.initials,
  size: 26
}))), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement(Button, {
  variant: "ghost",
  size: "sm",
  icon: "plus"
}, "Inviter"))));
Object.assign(window, {
  DashboardScreen
});