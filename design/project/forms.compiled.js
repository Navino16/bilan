/* Add forms — modal dialogs for create flows */

const Modal = ({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 480
}) => /*#__PURE__*/React.createElement("div", {
  onClick: onClose,
  style: {
    position: "absolute",
    inset: 0,
    zIndex: 40,
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
    width,
    maxWidth: "100%",
    maxHeight: "92%",
    boxShadow: "var(--shadow-3)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    padding: "20px 24px 14px",
    borderBottom: "1px solid var(--hairline)",
    display: "flex",
    alignItems: "flex-start",
    gap: 12
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "overline",
  style: {
    marginBottom: 6
  }
}, "Nouveau"), /*#__PURE__*/React.createElement("div", {
  className: "serif",
  style: {
    fontSize: 24,
    lineHeight: 1.1
  }
}, title), subtitle && /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 12.5,
    color: "var(--ink-3)",
    marginTop: 4
  }
}, subtitle)), /*#__PURE__*/React.createElement("button", {
  onClick: onClose,
  style: {
    color: "var(--ink-3)",
    padding: 4
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "x",
  size: 16
}))), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 24,
    overflowY: "auto",
    flex: 1
  },
  className: "scrollbar"
}, children), footer && /*#__PURE__*/React.createElement("div", {
  style: {
    padding: "12px 24px",
    borderTop: "1px solid var(--hairline)",
    background: "var(--paper)",
    display: "flex",
    justifyContent: "flex-end",
    gap: 8
  }
}, footer)));

// --- Bottom sheet for mobile -------------------------------------
const Sheet = ({
  title,
  subtitle,
  onClose,
  children,
  footer
}) => /*#__PURE__*/React.createElement("div", {
  onClick: onClose,
  style: {
    position: "absolute",
    inset: 0,
    zIndex: 40,
    background: "rgba(20,17,13,.35)",
    display: "flex",
    alignItems: "flex-end"
  }
}, /*#__PURE__*/React.createElement("div", {
  onClick: e => e.stopPropagation(),
  style: {
    width: "100%",
    maxHeight: "92%",
    background: "var(--card)",
    borderRadius: "20px 20px 0 0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    padding: "10px 0 0",
    display: "flex",
    justifyContent: "center"
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    width: 36,
    height: 4,
    borderRadius: 4,
    background: "var(--hairline-2)"
  }
})), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: "14px 20px 14px"
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "overline",
  style: {
    marginBottom: 4
  }
}, "Nouveau"), /*#__PURE__*/React.createElement("div", {
  className: "serif",
  style: {
    fontSize: 22,
    lineHeight: 1.1
  }
}, title), subtitle && /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 12,
    color: "var(--ink-3)",
    marginTop: 2
  }
}, subtitle)), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: "0 20px 16px",
    overflowY: "auto",
    flex: 1
  },
  className: "scrollbar"
}, children), footer && /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 16,
    borderTop: "1px solid var(--hairline)",
    background: "var(--paper)",
    display: "flex",
    flexDirection: "column",
    gap: 8
  }
}, footer)));

// pick the right surface depending on device
const FormShell = props => {
  const isMobile = props.device === "mobile";
  return isMobile ? /*#__PURE__*/React.createElement(Sheet, props) : /*#__PURE__*/React.createElement(Modal, props);
};

// ================== ADD TRANSACTION ==============================
const AddTransactionForm = ({
  device,
  onClose
}) => {
  const [type, setType] = React.useState("out");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState("2026-05-26");
  const [accountId, setAccountId] = React.useState("a_courant");
  const [categoryId, setCategoryId] = React.useState("c_groceries");
  const [label, setLabel] = React.useState("");
  return /*#__PURE__*/React.createElement(FormShell, {
    device: device,
    title: "Saisir une transaction",
    subtitle: "Op\xE9ration manuelle \u2014 sans import bancaire",
    onClose: onClose,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onClose
    }, "Annuler"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check"
    }, "Enregistrer"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "out",
      label: "Dépense"
    }, {
      id: "in",
      label: "Entrée"
    }, {
      id: "tx",
      label: "Virement interne"
    }],
    active: type,
    onChange: setType
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Montant"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 8,
      padding: "14px 16px",
      background: "var(--paper-2)",
      border: "1px solid var(--hairline)",
      borderRadius: 10
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: amount,
    onChange: e => setAmount(e.target.value),
    placeholder: "0,00",
    className: "num serif",
    style: {
      border: 0,
      outline: 0,
      background: "transparent",
      fontSize: 32,
      color: type === "in" ? "var(--income)" : "var(--ink)",
      fontFamily: "var(--font-display)",
      letterSpacing: "-.015em",
      width: "100%"
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "serif",
    style: {
      fontSize: 22,
      color: "var(--ink-3)"
    }
  }, "\u20AC"))), /*#__PURE__*/React.createElement(Field, {
    label: "Libell\xE9"
  }, /*#__PURE__*/React.createElement(Input, {
    value: label,
    onChange: e => setLabel(e.target.value),
    placeholder: "Carrefour Market\u2026"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Date"
  }, /*#__PURE__*/React.createElement(Input, {
    value: date,
    onChange: e => setDate(e.target.value),
    icon: "list"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Compte"
  }, /*#__PURE__*/React.createElement(SelectButton, null, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
      background: ACCOUNTS.find(a => a.id === accountId).color
    }
  }), ACCOUNTS.find(a => a.id === accountId).name))), /*#__PURE__*/React.createElement(Field, {
    label: "Cat\xE9gorie"
  }, /*#__PURE__*/React.createElement(CategoryPicker, {
    value: categoryId,
    onChange: setCategoryId
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Note (priv\xE9e)"
  }, /*#__PURE__*/React.createElement("textarea", {
    placeholder: "Optionnel \u2014 visible uniquement par vous",
    style: textareaStyle
  })), /*#__PURE__*/React.createElement(CheckRow, {
    label: "Affecter \xE0 un budget",
    off: true
  }), /*#__PURE__*/React.createElement(CheckRow, {
    label: "Marquer comme exclu des moyennes",
    off: true
  })));
};

// ================== ADD ACCOUNT ==================================
const AddAccountForm = ({
  device,
  onClose
}) => {
  const [type, setType] = React.useState("CHECKING");
  const [color, setColor] = React.useState("var(--cat-transport)");
  const palette = ["var(--cat-transport)", "var(--cat-housing)", "var(--cat-groceries)", "var(--cat-food)", "var(--cat-leisure)", "var(--cat-savings)", "var(--cat-shopping)", "var(--cat-bills)"];
  return /*#__PURE__*/React.createElement(FormShell, {
    device: device,
    title: "Ajouter un compte",
    subtitle: "Le compte devient visible dans les imports, les budgets et le partage.",
    onClose: onClose,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onClose
    }, "Annuler"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check"
    }, "Cr\xE9er le compte"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Type de compte"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "CHECKING",
      label: "Courant"
    }, {
      id: "SAVINGS",
      label: "Épargne"
    }, {
      id: "CREDIT",
      label: "Crédit"
    }, {
      id: "OTHER",
      label: "Autre"
    }],
    active: type,
    onChange: setType
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Nom du compte"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Compte courant"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Banque"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Cr\xE9dit Coop\xE9ratif"
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Solde initial"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 8,
      padding: "10px 12px",
      background: "var(--paper-2)",
      border: "1px solid var(--hairline)",
      borderRadius: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    placeholder: "0,00",
    className: "num",
    style: {
      border: 0,
      outline: 0,
      background: "transparent",
      fontSize: 18,
      color: "var(--ink)",
      width: "100%"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "var(--ink-3)"
    }
  }, "\u20AC"))), /*#__PURE__*/React.createElement(Field, {
    label: "IBAN (optionnel, chiffr\xE9)"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "FR76 \u2026",
    icon: "lock"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Couleur"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, palette.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    onClick: () => setColor(c),
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      background: c,
      border: color === c ? "2px solid var(--ink)" : "2px solid transparent",
      cursor: "pointer"
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      background: "var(--info-bg)",
      borderRadius: 8,
      fontSize: 12.5,
      color: "var(--info)",
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, "Ce compte sera priv\xE9 par d\xE9faut. Vous pourrez le partager avec Foyer Dupont une fois cr\xE9\xE9."))));
};

// ================== ADD CATEGORY =================================
const AddCategoryForm = ({
  device,
  onClose
}) => {
  const [color, setColor] = React.useState("var(--cat-groceries)");
  const [scope, setScope] = React.useState("user");
  const palette = ["var(--cat-groceries)", "var(--cat-housing)", "var(--cat-transport)", "var(--cat-food)", "var(--cat-leisure)", "var(--cat-health)", "var(--cat-savings)", "var(--cat-shopping)", "var(--cat-bills)", "var(--cat-other)"];
  const icons = ["○", "▢", "→", "△", "◇", "+", "★", "□", "≡", "·"];
  const [icon, setIcon] = React.useState("○");
  return /*#__PURE__*/React.createElement(FormShell, {
    device: device,
    title: "Nouvelle cat\xE9gorie",
    subtitle: "Vous pourrez attacher des r\xE8gles de cat\xE9gorisation apr\xE8s cr\xE9ation.",
    onClose: onClose,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onClose
    }, "Annuler"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check"
    }, "Cr\xE9er la cat\xE9gorie"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 18,
      background: "var(--paper-2)",
      border: "1px dashed var(--hairline-2)",
      borderRadius: 10,
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 10,
      background: color,
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 18
    }
  }, icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 2
    }
  }, "Aper\xE7u"), /*#__PURE__*/React.createElement(CategoryChip, {
    category: {
      name: "Ma catégorie",
      color
    }
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Nom"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Cantine, Cadeaux, Vacances\u2026"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Cat\xE9gorie parente"
  }, /*#__PURE__*/React.createElement(SelectButton, null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-3)"
    }
  }, "Aucune (cat\xE9gorie racine)"))), /*#__PURE__*/React.createElement(Field, {
    label: "Port\xE9e"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "user",
      label: "Personnel"
    }, {
      id: "group",
      label: "Foyer Dupont"
    }],
    active: scope,
    onChange: setScope
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)",
      marginTop: 6
    }
  }, scope === "group" ? "Visible par tous les membres du foyer." : "Visible uniquement par vous.")), /*#__PURE__*/React.createElement(Field, {
    label: "Couleur"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, palette.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    onClick: () => setColor(c),
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      background: c,
      border: color === c ? "2px solid var(--ink)" : "2px solid transparent"
    }
  })))), /*#__PURE__*/React.createElement(Field, {
    label: "Symbole"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, icons.map(g => /*#__PURE__*/React.createElement("button", {
    key: g,
    onClick: () => setIcon(g),
    style: {
      width: 32,
      height: 32,
      borderRadius: 8,
      background: icon === g ? "var(--ink)" : "var(--paper-2)",
      color: icon === g ? "var(--paper)" : "var(--ink)",
      border: "1px solid var(--hairline)",
      fontSize: 14,
      fontWeight: 500
    }
  }, g))))));
};

// ================== ADD BUDGET ===================================
const AddBudgetForm = ({
  device,
  onClose
}) => {
  const [period, setPeriod] = React.useState("MONTH");
  const [scope, setScope] = React.useState("user");
  const [lines, setLines] = React.useState([{
    id: 1,
    categoryId: "c_groceries",
    planned: 400
  }, {
    id: 2,
    categoryId: "c_food",
    planned: 150
  }, {
    id: 3,
    categoryId: "c_transport",
    planned: 200
  }]);
  const addLine = () => setLines([...lines, {
    id: Date.now(),
    categoryId: "c_other",
    planned: 0
  }]);
  const removeLine = id => setLines(lines.filter(l => l.id !== id));
  const total = lines.reduce((s, l) => s + Number(l.planned || 0), 0);
  return /*#__PURE__*/React.createElement(FormShell, {
    device: device,
    title: "Nouveau budget",
    subtitle: "Plan + plafonds par cat\xE9gorie pour une p\xE9riode.",
    width: 560,
    onClose: onClose,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onClose
    }, "Annuler"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check"
    }, "Cr\xE9er le budget"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Nom"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Juin 2026, Vacances \xE9t\xE9\u2026",
    defaultValue: "Juin 2026"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Port\xE9e"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "user",
      label: "Personnel"
    }, {
      id: "group",
      label: "Foyer Dupont"
    }],
    active: scope,
    onChange: setScope
  })), /*#__PURE__*/React.createElement(Field, {
    label: "P\xE9riodicit\xE9"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "MONTH",
      label: "Mois"
    }, {
      id: "QUARTER",
      label: "Trim."
    }, {
      id: "YEAR",
      label: "Année"
    }, {
      id: "CUSTOM",
      label: "Custom"
    }],
    active: period,
    onChange: setPeriod
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: device === "mobile" ? "1fr 1fr" : "1fr 1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "D\xE9but"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "01/06/2026"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Fin"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "30/06/2026"
  })), device !== "mobile" && /*#__PURE__*/React.createElement(Field, {
    label: "R\xE9currence"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      height: 36
    }
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: true,
    onChange: () => {}
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--ink-2)"
    }
  }, "Mensuel")))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--hairline)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline"
  }, "Lignes du budget"), /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      fontSize: 13,
      color: "var(--ink)"
    }
  }, fmtEUR(total, {
    decimals: 0
  }), " planifi\xE9")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, lines.map(l => {
    const cat = findCat(l.categoryId);
    return /*#__PURE__*/React.createElement("div", {
      key: l.id,
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 130px auto",
        gap: 8,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement(SelectButton, null, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: 8,
        background: cat.color
      }
    }), " ", cat.name), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        height: 36,
        background: "var(--card)",
        border: "1px solid var(--hairline-2)",
        borderRadius: 8
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "number",
      defaultValue: l.planned,
      className: "num",
      style: {
        flex: 1,
        border: 0,
        outline: 0,
        background: "transparent",
        fontSize: 13.5,
        color: "var(--ink)",
        width: "100%",
        textAlign: "right"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--ink-3)"
      }
    }, "\u20AC")), /*#__PURE__*/React.createElement("button", {
      onClick: () => removeLine(l.id),
      style: {
        color: "var(--ink-3)",
        padding: 8
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "trash",
      size: 14
    })));
  }), /*#__PURE__*/React.createElement("button", {
    onClick: addLine,
    style: {
      padding: "10px 12px",
      border: "1px dashed var(--hairline-2)",
      borderRadius: 8,
      color: "var(--ink-3)",
      fontSize: 13,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " Ajouter une ligne"))));
};

// ================== INVITE MEMBER ================================
const InviteMemberForm = ({
  device,
  onClose
}) => {
  const [role, setRole] = React.useState("MEMBER");
  return /*#__PURE__*/React.createElement(FormShell, {
    device: device,
    title: "Inviter un membre",
    subtitle: "Un email est envoy\xE9 avec un lien valable 7 jours.",
    onClose: onClose,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onClose
    }, "Annuler"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "mail"
    }, "Envoyer l'invitation"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Email"
  }, /*#__PURE__*/React.createElement(Input, {
    icon: "mail",
    placeholder: "thomas.martin@example.fr"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "R\xF4le dans le foyer"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "MEMBER",
      label: "Membre"
    }, {
      id: "ADMIN",
      label: "Administrateur"
    }],
    active: role,
    onChange: setRole
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)",
      marginTop: 6
    }
  }, role === "ADMIN" ? "Peut inviter / révoquer des membres et modifier les partages de compte." : "Peut consulter et modifier les transactions des comptes partagés.")), /*#__PURE__*/React.createElement(Field, {
    label: "Message (optionnel)"
  }, /*#__PURE__*/React.createElement("textarea", {
    placeholder: "Salut Thomas, j'ai ouvert un foyer Bilan pour partager nos comptes\u2026",
    style: textareaStyle
  }))));
};

// ================== HELPERS ======================================
const SelectButton = ({
  children
}) => /*#__PURE__*/React.createElement("button", {
  style: {
    height: 36,
    padding: "0 12px",
    background: "var(--card)",
    border: "1px solid var(--hairline-2)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13.5,
    color: "var(--ink)",
    width: "100%"
  }
}, children, /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement(Icon, {
  name: "chevron-down",
  size: 14
}));
const CategoryPicker = ({
  value,
  onChange
}) => {
  const top = CATEGORIES.filter(c => !c.parentId).slice(0, 8);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, top.map(c => {
    const active = value === c.id;
    return /*#__PURE__*/React.createElement("button", {
      key: c.id,
      onClick: () => onChange(c.id),
      style: {
        padding: "6px 10px 6px 8px",
        borderRadius: 999,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: active ? "var(--ink)" : "var(--paper-2)",
        color: active ? "var(--paper)" : "var(--ink)",
        border: "1px solid " + (active ? "var(--ink)" : "var(--hairline)"),
        fontSize: 12.5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: 8,
        background: c.color
      }
    }), c.name);
  }));
};
const textareaStyle = {
  width: "100%",
  minHeight: 70,
  padding: "10px 12px",
  background: "var(--card)",
  border: "1px solid var(--hairline-2)",
  borderRadius: 8,
  fontSize: 13.5,
  fontFamily: "var(--font-sans)",
  color: "var(--ink)",
  resize: "vertical",
  outline: "none"
};

// ================== MOBILE DRAWER ================================
const MobileDrawer = ({
  open,
  onClose,
  route,
  setRoute,
  theme,
  setTheme
}) => {
  if (!open) return null;
  const all = [{
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
  const adm = [{
    id: "settings",
    label: "Préférences",
    icon: "settings"
  }, {
    id: "admin",
    label: "Administration",
    icon: "shield"
  }];
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: "absolute",
      inset: 0,
      zIndex: 50,
      background: "rgba(20,17,13,.45)",
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: "82%",
      maxWidth: 320,
      height: "100%",
      background: "var(--paper)",
      display: "flex",
      flexDirection: "column",
      padding: "20px 14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(BilanMark, {
    size: 28
  }), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 22,
      letterSpacing: "-.015em"
    }
  }, "Bilan")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      width: 36,
      height: 36,
      borderRadius: 8,
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 18
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 10px",
      background: "var(--card)",
      border: "1px solid var(--hairline)",
      borderRadius: 10,
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: "PD",
    size: 36
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--ink)",
      fontWeight: 500
    }
  }, "Pierre Dupont"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, "Foyer Dupont \xB7 SUPER_ADMIN"))), /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      padding: "0 10px 6px"
    }
  }, "Espace"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, all.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    onClick: () => {
      setRoute(n.id);
      onClose();
    },
    style: drawerItem(route === n.id)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n.icon,
    size: 16
  }), " ", n.label))), /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      padding: "16px 10px 6px"
    }
  }, "Compte"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, adm.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    onClick: () => {
      setRoute(n.id);
      onClose();
    },
    style: drawerItem(route === n.id)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n.icon,
    size: 16
  }), " ", n.label)), /*#__PURE__*/React.createElement("button", {
    onClick: () => setTheme(theme === "light" ? "dark" : "light"),
    style: drawerItem(false)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: theme === "light" ? "moon" : "sun",
    size: 16
  }), " Th\xE8me\u202F: ", theme === "light" ? "clair" : "sombre")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      ...drawerItem(false),
      color: "var(--expense)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 16
  }), " Se d\xE9connecter")));
};
const drawerItem = active => ({
  padding: "10px 10px",
  display: "flex",
  alignItems: "center",
  gap: 10,
  borderRadius: 8,
  background: active ? "var(--card)" : "transparent",
  border: "1px solid " + (active ? "var(--hairline)" : "transparent"),
  color: active ? "var(--ink)" : "var(--ink-2)",
  fontWeight: active ? 500 : 400,
  fontSize: 13.5,
  textAlign: "left",
  width: "100%"
});
Object.assign(window, {
  Modal,
  Sheet,
  FormShell,
  AddTransactionForm,
  AddAccountForm,
  AddCategoryForm,
  AddBudgetForm,
  InviteMemberForm,
  MobileDrawer
});