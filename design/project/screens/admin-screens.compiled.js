/* Import CSV + Auth + Settings + Admin screens */

// ============== IMPORT CSV =======================================
const ImportScreen = ({
  device
}) => {
  const isMobile = device === "mobile";
  const [step, setStep] = React.useState(2); // 0=upload 1=parsing 2=mapping 3=commit 4=done
  const [account, setAccount] = React.useState("a_courant");
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
  }, "Import"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32
    }
  }, "Importer un relev\xE9")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-3)"
    }
  }, "CSV \xB7 PDF \xB7 Saisie manuelle")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 0,
      marginBottom: 18,
      padding: "12px 14px",
      background: "var(--card)",
      border: "1px solid var(--hairline)",
      borderRadius: 12,
      overflowX: "auto"
    },
    className: "scrollbar"
  }, ["Fichier", "Lecture", "Correspondances", "Validation"].map((s, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: s
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      opacity: step >= i ? 1 : 0.45
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 22,
      height: 22,
      borderRadius: 22,
      background: step > i ? "var(--primary)" : step === i ? "var(--ink)" : "var(--paper-2)",
      color: step >= i ? "var(--paper)" : "var(--ink-3)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 11.5,
      fontWeight: 600,
      fontFamily: "var(--font-mono)"
    }
  }, step > i ? "✓" : i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: step === i ? "var(--ink)" : "var(--ink-3)",
      fontWeight: step === i ? 500 : 400,
      whiteSpace: "nowrap"
    }
  }, s)), i < 3 && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 30,
      height: 1,
      background: "var(--hairline)",
      margin: "0 12px"
    }
  })))), step === 2 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "320px 1fr",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Fichier"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 10,
      background: "var(--paper-2)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 8,
      background: "var(--ink)",
      color: "var(--paper)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-mono)",
      fontSize: 10
    }
  }, "CSV"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--ink)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "releve-mai-2026.csv"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, "28 lignes \xB7 4,2 Ko"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Compte de destination"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, ACCOUNTS.map(a => /*#__PURE__*/React.createElement("button", {
    key: a.id,
    onClick: () => setAccount(a.id),
    style: {
      padding: "10px 12px",
      borderRadius: 8,
      background: account === a.id ? "var(--primary-soft)" : "var(--card-2)",
      border: "1px solid " + (account === a.id ? "var(--primary)" : "var(--hairline)"),
      display: "flex",
      alignItems: "center",
      gap: 10,
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
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
      fontSize: 10.5,
      color: "var(--ink-3)"
    }
  }, a.bank)), account === a.id && /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Correspondance des colonnes"), /*#__PURE__*/React.createElement(FieldMap, {
    label: "Date",
    value: "Date op\xE9ration"
  }), /*#__PURE__*/React.createElement(FieldMap, {
    label: "Libell\xE9",
    value: "Libell\xE9"
  }), /*#__PURE__*/React.createElement(FieldMap, {
    label: "Montant",
    value: "Montant"
  }), /*#__PURE__*/React.createElement(FieldMap, {
    label: "Type",
    value: "auto-d\xE9tect\xE9"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Options"), /*#__PURE__*/React.createElement(CheckRow, {
    label: "D\xE9tecter les doublons"
  }), /*#__PURE__*/React.createElement(CheckRow, {
    label: "Cat\xE9goriser automatiquement"
  }), /*#__PURE__*/React.createElement(CheckRow, {
    label: "Sugg\xE9rer des liens",
    off: true
  }))), /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      padding: "16px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, "Aper\xE7u \u2014 28 transactions"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, "3 doublons potentiels \xB7 26 cat\xE9goris\xE9es automatiquement")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    iconRight: "chevron-right"
  }, "Valider l'import")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "70px 1fr 1fr 130px 110px",
      gap: 12,
      padding: "10px 20px",
      background: "var(--paper-2)",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".08em",
      color: "var(--ink-3)",
      borderTop: "1px solid var(--hairline)",
      borderBottom: "1px solid var(--hairline)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Date"), /*#__PURE__*/React.createElement("span", null, "Libell\xE9 brut"), /*#__PURE__*/React.createElement("span", null, "Cat\xE9gorie sugg\xE9r\xE9e"), /*#__PURE__*/React.createElement("span", null, "Type"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: "right"
    }
  }, "Montant")), TRANSACTIONS.slice(0, 10).map((t, i) => {
    const cat = findCat(t.categoryId);
    const dup = i === 6;
    return /*#__PURE__*/React.createElement("div", {
      key: t.id,
      style: {
        display: "grid",
        gridTemplateColumns: "70px 1fr 1fr 130px 110px",
        gap: 12,
        padding: "10px 20px",
        alignItems: "center",
        borderTop: "1px solid var(--hairline)",
        background: dup ? "var(--warning-bg)" : "transparent"
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        fontSize: 12,
        color: "var(--ink-3)"
      }
    }, fmtDate(t.date)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        fontFamily: "var(--font-mono)",
        color: "var(--ink-2)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, t.rawLabel), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(CategoryChip, {
      category: cat,
      size: "sm"
    }), dup && /*#__PURE__*/React.createElement(Pill, {
      tone: "warning",
      dot: true
    }, "doublon")), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11.5,
        color: "var(--ink-3)"
      }
    }, labelType(t.type)), /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        fontSize: 13,
        fontWeight: 500,
        color: t.amount > 0 ? "var(--income)" : "var(--ink)",
        textAlign: "right"
      }
    }, fmtEUR(t.amount, {
      sign: t.amount > 0
    })));
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 20px",
      borderTop: "1px solid var(--hairline)",
      textAlign: "center",
      color: "var(--ink-3)",
      fontSize: 12
    }
  }, "+ 18 lignes suppl\xE9mentaires"))));
};
const FieldMap = ({
  label,
  value
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid var(--hairline)"
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 70,
    fontSize: 12,
    color: "var(--ink-3)"
  }
}, label), /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1,
    fontSize: 12.5,
    color: "var(--ink)"
  }
}, value), /*#__PURE__*/React.createElement(Icon, {
  name: "check",
  size: 13
}));
const CheckRow = ({
  label,
  off
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    alignItems: "center",
    padding: "6px 0",
    gap: 10
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 16,
    height: 16,
    borderRadius: 4,
    background: off ? "transparent" : "var(--primary)",
    border: "1px solid " + (off ? "var(--hairline-2)" : "var(--primary)"),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff"
  }
}, !off && /*#__PURE__*/React.createElement(Icon, {
  name: "check",
  size: 11,
  stroke: 3
})), /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 12.5,
    color: off ? "var(--ink-3)" : "var(--ink)"
  }
}, label));

// ============== AUTH =============================================
const AuthScreen = ({
  device
}) => {
  const isMobile = device === "mobile";
  const [mode, setMode] = React.useState("login"); // login | signup | setup | 2fa | reset
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100%",
      display: "flex",
      background: mode === "setup" ? "var(--paper)" : "var(--paper)"
    }
  }, !isMobile && mode !== "setup" && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: 48,
      background: "var(--ink)",
      color: "var(--paper)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(BilanMark, {
    size: 32
  }), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 26,
      color: "var(--paper)"
    }
  }, "Bilan")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      zIndex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 56,
      lineHeight: 1.05,
      letterSpacing: "-.015em",
      maxWidth: 520
    }
  }, "Comprendre o\xF9 passe l'argent, sans c\xE9der son intimit\xE9."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20,
      fontSize: 14,
      color: "rgba(243,239,230,.55)",
      maxWidth: 480,
      lineHeight: 1.5
    }
  }, "Bilan chiffre vos relev\xE9s sur votre serveur. Multi-comptes, partage \xE0 la maille, cat\xE9gorisation apprise."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 32,
      display: "flex",
      gap: 14,
      fontSize: 12,
      color: "rgba(243,239,230,.45)",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", null, "AES-256-GCM"), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, "Argon2id"), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, "2FA & passkeys"), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, "OIDC"))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "rgba(243,239,230,.4)"
    }
  }, "v0.9.0 \xB7 self-hosted")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: isMobile ? 1 : 0,
      width: isMobile ? "100%" : 480,
      padding: isMobile ? 24 : 48,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center"
    }
  }, isMobile && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 36
    }
  }, /*#__PURE__*/React.createElement(BilanMark, {
    size: 28
  }), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 22
    }
  }, "Bilan")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "login",
      label: "Connexion"
    }, {
      id: "signup",
      label: "Inscription"
    }, {
      id: "setup",
      label: "1er lancement"
    }],
    active: mode,
    onChange: setMode
  })), mode === "login" && /*#__PURE__*/React.createElement(LoginForm, null), mode === "signup" && /*#__PURE__*/React.createElement(SignupForm, null), mode === "setup" && /*#__PURE__*/React.createElement(SetupWizard, null)));
};
const LoginForm = () => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
  className: "serif",
  style: {
    fontSize: 30,
    lineHeight: 1.1
  }
}, "Bon retour."), /*#__PURE__*/React.createElement("div", {
  style: {
    color: "var(--ink-3)",
    fontSize: 13.5,
    marginTop: 4,
    marginBottom: 24
  }
}, "Connectez-vous \xE0 votre instance Bilan."), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    flexDirection: "column",
    gap: 14
  }
}, /*#__PURE__*/React.createElement(Field, {
  label: "Email"
}, /*#__PURE__*/React.createElement(Input, {
  icon: "mail",
  placeholder: "pierre.dupont@example.fr",
  defaultValue: "pierre.dupont@example.fr"
})), /*#__PURE__*/React.createElement(Field, {
  label: "Mot de passe"
}, /*#__PURE__*/React.createElement(Input, {
  icon: "lock",
  type: "password",
  placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
  defaultValue: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
})), /*#__PURE__*/React.createElement("div", {
  className: "between",
  style: {
    marginTop: 2
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "row",
  style: {
    gap: 8
  }
}, /*#__PURE__*/React.createElement(CheckRow, {
  label: "Se souvenir de moi"
})), /*#__PURE__*/React.createElement("a", {
  style: {
    fontSize: 12.5,
    color: "var(--primary)"
  }
}, "Mot de passe oubli\xE9\u202F?")), /*#__PURE__*/React.createElement(Button, {
  variant: "primary",
  full: true,
  size: "lg"
}, "Se connecter"), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "6px 0",
    color: "var(--ink-3)",
    fontSize: 11.5
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1,
    height: 1,
    background: "var(--hairline)"
  }
}), "ou continuer avec", /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1,
    height: 1,
    background: "var(--hairline)"
  }
})), /*#__PURE__*/React.createElement(Button, {
  variant: "secondary",
  full: true,
  icon: "key"
}, "Authentik (Foyer Dupont)"), /*#__PURE__*/React.createElement(Button, {
  variant: "secondary",
  full: true,
  icon: "external"
}, "Passkey")), /*#__PURE__*/React.createElement("div", {
  style: {
    marginTop: 24,
    fontSize: 12.5,
    color: "var(--ink-3)",
    textAlign: "center"
  }
}, "Premier acc\xE8s\u202F? ", /*#__PURE__*/React.createElement("a", {
  style: {
    color: "var(--primary)"
  }
}, "Demander une invitation")));
const SignupForm = () => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
  className: "serif",
  style: {
    fontSize: 30,
    lineHeight: 1.1
  }
}, "Cr\xE9er un compte."), /*#__PURE__*/React.createElement("div", {
  style: {
    color: "var(--ink-3)",
    fontSize: 13.5,
    marginTop: 4,
    marginBottom: 24
  }
}, "Invit\xE9\xA0: ", /*#__PURE__*/React.createElement("strong", {
  style: {
    color: "var(--ink)"
  }
}, "Foyer Dupont"), " \xB7 Pierre Dupont"), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    flexDirection: "column",
    gap: 14
  }
}, /*#__PURE__*/React.createElement(Field, {
  label: "Nom complet"
}, /*#__PURE__*/React.createElement(Input, {
  placeholder: "Claire Dupont"
})), /*#__PURE__*/React.createElement(Field, {
  label: "Email"
}, /*#__PURE__*/React.createElement(Input, {
  icon: "mail",
  placeholder: "claire.dupont@example.fr"
})), /*#__PURE__*/React.createElement(Field, {
  label: "Mot de passe"
}, /*#__PURE__*/React.createElement(Input, {
  icon: "lock",
  type: "password",
  placeholder: "Au moins 12 caract\xE8res"
})), /*#__PURE__*/React.createElement(PasswordStrength, {
  score: 3
}), /*#__PURE__*/React.createElement(Field, {
  label: "Langue"
}, /*#__PURE__*/React.createElement(Tabs, {
  items: [{
    id: "fr",
    label: "Français"
  }, {
    id: "en",
    label: "English"
  }],
  active: "fr",
  onChange: () => {}
})), /*#__PURE__*/React.createElement(Button, {
  variant: "primary",
  full: true,
  size: "lg"
}, "Cr\xE9er mon compte")), /*#__PURE__*/React.createElement("div", {
  style: {
    marginTop: 16,
    fontSize: 11.5,
    color: "var(--ink-3)",
    lineHeight: 1.5
  }
}, "En continuant, vous acceptez les conditions d'utilisation de cette instance Bilan. Aucune donn\xE9e n'est transmise \xE0 un tiers."));
const PasswordStrength = ({
  score = 2
}) => {
  const labels = ["Faible", "Moyen", "Bon", "Excellent"];
  const colors = ["var(--expense)", "var(--warning)", "var(--primary)", "var(--income)"];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 3
    }
  }, [0, 1, 2, 3].map(i => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      background: i <= score ? colors[score] : "var(--paper-2)"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: colors[score],
      marginTop: 6
    }
  }, "Force du mot de passe\u202F: ", labels[score]));
};
const SetupWizard = () => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
  className: "overline",
  style: {
    marginBottom: 8
  }
}, "Premier lancement \xB7 \xC9tape 1 sur 4"), /*#__PURE__*/React.createElement("div", {
  className: "serif",
  style: {
    fontSize: 30,
    lineHeight: 1.1
  }
}, "Bienvenue dans Bilan."), /*#__PURE__*/React.createElement("div", {
  style: {
    color: "var(--ink-3)",
    fontSize: 13.5,
    marginTop: 4,
    marginBottom: 24
  }
}, "Cr\xE9ez le premier compte administrateur. Cet utilisateur aura le r\xF4le SUPER_ADMIN."), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    flexDirection: "column",
    gap: 14
  }
}, /*#__PURE__*/React.createElement(Field, {
  label: "Nom"
}, /*#__PURE__*/React.createElement(Input, {
  placeholder: "Pierre Dupont"
})), /*#__PURE__*/React.createElement(Field, {
  label: "Email"
}, /*#__PURE__*/React.createElement(Input, {
  icon: "mail",
  placeholder: "pierre@dupont.fr"
})), /*#__PURE__*/React.createElement(Field, {
  label: "Mot de passe"
}, /*#__PURE__*/React.createElement(Input, {
  icon: "lock",
  type: "password",
  placeholder: "Au moins 12 caract\xE8res"
})), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 12,
    background: "var(--info-bg)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--info)",
    display: "flex",
    gap: 8
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "info",
  size: 14
}), /*#__PURE__*/React.createElement("span", null, "Aux prochaines \xE9tapes\u202F: SMTP, fournisseur OIDC, mode d'inscription (par d\xE9faut ", /*#__PURE__*/React.createElement("strong", null, "invitation uniquement"), ").")), /*#__PURE__*/React.createElement(Button, {
  variant: "primary",
  full: true,
  size: "lg",
  iconRight: "chevron-right"
}, "Continuer")));

// ============== SETTINGS ==========================================
const SettingsScreen = ({
  device
}) => {
  const isMobile = device === "mobile";
  const [tab, setTab] = React.useState("profile");
  const {
    theme,
    setTheme
  } = React.useContext(window.AppContext);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? 16 : 32,
      paddingBottom: isMobile ? 96 : 32
    }
  }, !isMobile && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "Mon compte"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32
    }
  }, "Pr\xE9f\xE9rences")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "200px 1fr",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: isMobile ? "row" : "column",
      gap: 4,
      overflowX: "auto"
    },
    className: "scrollbar"
  }, [{
    id: "profile",
    label: "Profil",
    icon: "settings"
  }, {
    id: "security",
    label: "Sécurité",
    icon: "shield"
  }, {
    id: "sessions",
    label: "Sessions",
    icon: "key"
  }, {
    id: "data",
    label: "Mes données",
    icon: "download"
  }].map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    onClick: () => setTab(t.id),
    style: {
      padding: "8px 12px",
      borderRadius: 7,
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: tab === t.id ? "var(--card)" : "transparent",
      border: "1px solid " + (tab === t.id ? "var(--hairline)" : "transparent"),
      color: tab === t.id ? "var(--ink)" : "var(--ink-3)",
      fontSize: 13,
      fontWeight: tab === t.id ? 500 : 400,
      whiteSpace: "nowrap",
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: t.icon,
    size: 14
  }), " ", t.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, tab === "profile" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 12
    }
  }, "Identit\xE9"), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      marginBottom: 16,
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: "PD",
    size: 56
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 500,
      color: "var(--ink)"
    }
  }, "Pierre Dupont"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, "pierre.dupont@example.fr \xB7 SUPER_ADMIN"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Nom"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "Pierre Dupont"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Email"
  }, /*#__PURE__*/React.createElement(Input, {
    icon: "mail",
    defaultValue: "pierre.dupont@example.fr"
  })))), /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 12
    }
  }, "Pr\xE9f\xE9rences"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(SettingRow, {
    title: "Langue",
    sub: "Affichage des libell\xE9s, dates et nombres"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "fr",
      label: "Français"
    }, {
      id: "en",
      label: "English"
    }],
    active: "fr",
    onChange: () => {}
  })), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Th\xE8me",
    sub: theme === "light" ? "Clair — fond papier" : "Sombre — fond encre"
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "light",
      label: "Clair"
    }, {
      id: "dark",
      label: "Sombre"
    }],
    active: theme,
    onChange: setTheme
  })), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Compte par d\xE9faut",
    sub: "Pr\xE9-s\xE9lectionn\xE9 \xE0 l'import et lors de la saisie"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--ink-2)"
    }
  }, "Compte courant")), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Fen\xEAtre de liaison",
    sub: "\xC9cart maximal entre deux transactions pour sugg\xE9rer un lien"
  }, /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 13,
      color: "var(--ink-2)"
    }
  }, "30 jours"))))), tab === "security" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 12
    }
  }, "Mot de passe"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
      gap: 12,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Actuel"
  }, /*#__PURE__*/React.createElement(Input, {
    icon: "lock",
    type: "password"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Nouveau"
  }, /*#__PURE__*/React.createElement(Input, {
    icon: "lock",
    type: "password"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Confirmation"
  }, /*#__PURE__*/React.createElement(Input, {
    icon: "lock",
    type: "password"
  }))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm"
  }, "Changer le mot de passe")), /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 12
    }
  }, "Authentification \xE0 deux facteurs"), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Application authentificator",
    sub: "Activ\xE9 \xB7 8 codes de secours"
  }, /*#__PURE__*/React.createElement(Pill, {
    tone: "success",
    dot: true
  }, "Actif")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--hairline)",
      margin: "12px 0"
    }
  }), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Cl\xE9 d'acc\xE8s (passkey)",
    sub: "MacBook Pro \xB7 enregistr\xE9e le 12 mai 2026"
  }, /*#__PURE__*/React.createElement(Pill, {
    tone: "success",
    dot: true
  }, "Active")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "plus"
  }, "Ajouter une cl\xE9 d'acc\xE8s")))), tab === "sessions" && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "Sessions actives"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, SESSIONS.length, " sessions ouvertes")), SESSIONS.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.id,
    style: {
      padding: "14px 20px",
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 36,
      height: 36,
      borderRadius: 8,
      background: "var(--paper-2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "key",
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink)"
    }
  }, s.device), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, s.ip, " \xB7 ", s.last)), s.current ? /*#__PURE__*/React.createElement(Pill, {
    tone: "primary",
    dot: true
  }, "Cette session") : /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, "R\xE9voquer"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14,
      borderTop: "1px solid var(--hairline)",
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "sm"
  }, "R\xE9voquer toutes les autres"))), tab === "data" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8
    }
  }, "Export de mes donn\xE9es"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--ink-2)",
      marginBottom: 14,
      lineHeight: 1.5
    }
  }, "T\xE9l\xE9chargez l'ensemble de vos comptes, transactions, cat\xE9gories, r\xE8gles, budgets et liens au format JSON."), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "download"
  }, "T\xE9l\xE9charger l'export (JSON)")), /*#__PURE__*/React.createElement(Card, {
    padding: 20,
    style: {
      borderColor: "var(--expense-bg)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 8,
      color: "var(--expense)"
    }
  }, "Zone \xE0 risque"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--ink)",
      marginBottom: 4
    }
  }, "Supprimer mon compte"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-3)",
      marginBottom: 14,
      lineHeight: 1.5
    }
  }, "Suppression irr\xE9versible. Toutes vos transactions, cat\xE9gories personnelles et budgets seront d\xE9finitivement effac\xE9s."), /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "sm",
    icon: "trash"
  }, "Supprimer mon compte"))))));
};
const SettingRow = ({
  title,
  sub,
  children
}) => /*#__PURE__*/React.createElement("div", {
  className: "between",
  style: {
    alignItems: "flex-start",
    gap: 12
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    minWidth: 0
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 13.5,
    color: "var(--ink)"
  }
}, title), sub && /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 11.5,
    color: "var(--ink-3)",
    marginTop: 2
  }
}, sub)), children);

// ============== ADMIN =============================================
const AdminScreen = ({
  device
}) => {
  const isMobile = device === "mobile";
  const [tab, setTab] = React.useState("providers");
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
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield",
    size: 22
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "overline",
    style: {
      marginBottom: 4
    }
  }, "Admin \xB7 SUPER_ADMIN"), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 32
    }
  }, "Administration"))), /*#__PURE__*/React.createElement(Pill, {
    tone: "warning",
    dot: true
  }, "Mode invitation uniquement")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    items: [{
      id: "providers",
      label: "Authentification"
    }, {
      id: "smtp",
      label: "SMTP"
    }, {
      id: "users",
      label: "Utilisateurs"
    }, {
      id: "audit",
      label: "Journal d'audit"
    }],
    active: tab,
    onChange: setTab
  })), tab === "providers" && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      padding: "16px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, "Fournisseurs d'identit\xE9"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, "Modifications appliqu\xE9es \xE0 chaud (cache 60 s)")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    icon: "plus"
  }, "Ajouter un fournisseur")), AUTH_PROVIDERS.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      padding: "14px 20px",
      borderTop: "1px solid var(--hairline)",
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 8,
      background: p.enabled ? "var(--primary-soft)" : "var(--paper-2)",
      color: p.enabled ? "var(--primary)" : "var(--ink-3)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 11,
      fontFamily: "var(--font-mono)",
      fontWeight: 600,
      border: "1px solid var(--hairline)"
    }
  }, p.type.toUpperCase().slice(0, 4)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "var(--ink)"
    }
  }, p.displayName), p.enabled ? /*#__PURE__*/React.createElement(Pill, {
    tone: "success",
    dot: true
  }, "actif") : /*#__PURE__*/React.createElement(Pill, {
    tone: "neutral"
  }, "d\xE9sactiv\xE9")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)",
      marginTop: 3,
      fontFamily: "var(--font-mono)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, p.details)), /*#__PURE__*/React.createElement(Switch, {
    checked: p.enabled,
    onChange: () => {}
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "edit",
    size: 14
  }))))), tab === "smtp" && /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, "Configuration SMTP"), /*#__PURE__*/React.createElement(Pill, {
    tone: "success",
    dot: true
  }, "Connect\xE9")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "H\xF4te"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "smtp.mailgun.org"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Port"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "587"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Utilisateur"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "postmaster@dupont.fr"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Mot de passe"
  }, /*#__PURE__*/React.createElement(Input, {
    type: "password",
    defaultValue: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    icon: "lock"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Exp\xE9diteur"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "Bilan <noreply@dupont.fr>"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "TLS"
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
  }, "STARTTLS activ\xE9")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm"
  }, "Enregistrer"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "mail"
  }, "Envoyer un test"))), tab === "users" && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      padding: "16px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, "Utilisateurs \xB7 2 actifs"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, "Mode d'inscription\u202F: invitation uniquement")), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "key"
  }, "Jeton d'inscription"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    icon: "plus"
  }, "Cr\xE9er un utilisateur"))), HOUSEHOLD.members.map(m => /*#__PURE__*/React.createElement("div", {
    key: m.id,
    style: {
      padding: "14px 20px",
      borderTop: "1px solid var(--hairline)",
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr auto" : "auto 1fr auto auto auto auto",
      gap: 14,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: m.initials,
    size: 32
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink)"
    }
  }, m.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, m.id === "u_pierre" ? "pierre.dupont@example.fr" : "claire.dupont@example.fr")), !isMobile && /*#__PURE__*/React.createElement(Pill, {
    tone: m.role === "OWNER" ? "primary" : "neutral"
  }, m.role === "OWNER" ? "SUPER_ADMIN" : "USER"), !isMobile && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-3)"
    }
  }, "il y a 2 h"), !isMobile && /*#__PURE__*/React.createElement(Pill, {
    tone: "success",
    dot: true
  }, "Actif"), /*#__PURE__*/React.createElement("button", {
    style: {
      color: "var(--ink-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "more",
    size: 16
  }))))), tab === "audit" && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    className: "between",
    style: {
      padding: "16px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 18
    }
  }, "Journal d'audit"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-3)"
    }
  }, "R\xE9tention\u202F: 12 mois")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "download"
  }, "Exporter")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr auto" : "120px 130px 1fr 1fr 120px",
      gap: 12,
      padding: "10px 20px",
      background: "var(--paper-2)",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".08em",
      color: "var(--ink-3)",
      borderTop: "1px solid var(--hairline)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Horodatage"), !isMobile && /*#__PURE__*/React.createElement("span", null, "Acteur"), !isMobile && /*#__PURE__*/React.createElement("span", null, "Action"), /*#__PURE__*/React.createElement("span", null, "Cible"), !isMobile && /*#__PURE__*/React.createElement("span", null, "IP")), AUDIT.map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr auto" : "120px 130px 1fr 1fr 120px",
      gap: 12,
      padding: "10px 20px",
      alignItems: "center",
      borderTop: "1px solid var(--hairline)",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      color: "var(--ink-3)"
    }
  }, a.ts), !isMobile && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-2)"
    }
  }, a.actor), !isMobile && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--ink)"
    }
  }, a.action), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-2)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, a.target), !isMobile && /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 11,
      color: "var(--ink-3)"
    }
  }, a.ip)))));
};
Object.assign(window, {
  ImportScreen,
  AuthScreen,
  SettingsScreen,
  AdminScreen
});