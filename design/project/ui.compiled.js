function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Shared UI primitives + helpers for Bilan */

// --- Formatting -----------------------------------------------------
const fmtEUR = (v, {
  sign = false,
  decimals = 2
} = {}) => {
  const abs = Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  const s = sign ? v > 0 ? "+ " : v < 0 ? "− " : "" : v < 0 ? "− " : "";
  return `${s}${abs} €`;
};
const fmtEURcompact = v => {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString("fr-FR", {
    maximumFractionDigits: 1
  })} k €`;
  return `${v.toLocaleString("fr-FR", {
    maximumFractionDigits: 0
  })} €`;
};
const fmtDate = iso => {
  const d = new Date(iso);
  const months = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  return `${d.getDate()} ${months[d.getMonth()]}`;
};
const fmtDateLong = iso => {
  const d = new Date(iso);
  const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const days = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

// --- Icons (Lucide-style line, drawn inline) -----------------------
const Icon = ({
  name,
  size = 16,
  stroke = 1.6
}) => {
  const c = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };
  switch (name) {
    case "home":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"
      }));
    case "list":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("line", {
        x1: "8",
        y1: "6",
        x2: "21",
        y2: "6"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "8",
        y1: "12",
        x2: "21",
        y2: "12"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "8",
        y1: "18",
        x2: "21",
        y2: "18"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "3",
        y1: "6",
        x2: "3.01",
        y2: "6"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "3",
        y1: "12",
        x2: "3.01",
        y2: "12"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "3",
        y1: "18",
        x2: "3.01",
        y2: "18"
      }));
    case "wallet":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M20 12V8H6a2 2 0 0 1 0-4h12v4"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M4 6v12a2 2 0 0 0 2 2h14v-4"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M18 12a2 2 0 0 0 0 4h4v-4z"
      }));
    case "target":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "10"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "6"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "2"
      }));
    case "tag":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "7.5",
        cy: "7.5",
        r: "1.5"
      }));
    case "link":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"
      }));
    case "users":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "9",
        cy: "7",
        r: "4"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M23 21v-2a4 4 0 0 0-3-3.87"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M16 3.13a4 4 0 0 1 0 7.75"
      }));
    case "upload":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
      }), /*#__PURE__*/React.createElement("polyline", {
        points: "17 8 12 3 7 8"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "12",
        y1: "3",
        x2: "12",
        y2: "15"
      }));
    case "shield":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
      }));
    case "settings":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "3"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
      }));
    case "search":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("circle", {
        cx: "11",
        cy: "11",
        r: "7"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "21",
        y1: "21",
        x2: "16.65",
        y2: "16.65"
      }));
    case "plus":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("line", {
        x1: "12",
        y1: "5",
        x2: "12",
        y2: "19"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "5",
        y1: "12",
        x2: "19",
        y2: "12"
      }));
    case "chevron-left":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("polyline", {
        points: "15 18 9 12 15 6"
      }));
    case "chevron-right":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("polyline", {
        points: "9 18 15 12 9 6"
      }));
    case "chevron-down":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("polyline", {
        points: "6 9 12 15 18 9"
      }));
    case "x":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("line", {
        x1: "18",
        y1: "6",
        x2: "6",
        y2: "18"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "6",
        y1: "6",
        x2: "18",
        y2: "18"
      }));
    case "check":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("polyline", {
        points: "20 6 9 17 4 12"
      }));
    case "more":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "1"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "19",
        cy: "12",
        r: "1"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "5",
        cy: "12",
        r: "1"
      }));
    case "filter":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("polygon", {
        points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
      }));
    case "sort":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M3 6h18"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M6 12h12"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M9 18h6"
      }));
    case "menu":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("line", {
        x1: "3",
        y1: "6",
        x2: "21",
        y2: "6"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "3",
        y1: "12",
        x2: "21",
        y2: "12"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "3",
        y1: "18",
        x2: "21",
        y2: "18"
      }));
    case "alert":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "12",
        y1: "9",
        x2: "12",
        y2: "13"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "12",
        y1: "17",
        x2: "12.01",
        y2: "17"
      }));
    case "info":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "10"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "12",
        y1: "16",
        x2: "12",
        y2: "12"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "12",
        y1: "8",
        x2: "12.01",
        y2: "8"
      }));
    case "trash":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("polyline", {
        points: "3 6 5 6 21 6"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
      }));
    case "edit":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M12 20h9"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"
      }));
    case "share":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("circle", {
        cx: "18",
        cy: "5",
        r: "3"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "6",
        cy: "12",
        r: "3"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "18",
        cy: "19",
        r: "3"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "8.59",
        y1: "13.51",
        x2: "15.42",
        y2: "17.49"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "15.41",
        y1: "6.51",
        x2: "8.59",
        y2: "10.49"
      }));
    case "download":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
      }), /*#__PURE__*/React.createElement("polyline", {
        points: "7 10 12 15 17 10"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "12",
        y1: "15",
        x2: "12",
        y2: "3"
      }));
    case "external":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
      }), /*#__PURE__*/React.createElement("polyline", {
        points: "15 3 21 3 21 9"
      }), /*#__PURE__*/React.createElement("line", {
        x1: "10",
        y1: "14",
        x2: "21",
        y2: "3"
      }));
    case "moon":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
      }));
    case "sun":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "4"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      }));
    case "key":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"
      }));
    case "lock":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("rect", {
        x: "3",
        y: "11",
        width: "18",
        height: "11",
        rx: "2"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M7 11V7a5 5 0 0 1 10 0v4"
      }));
    case "mail":
      return /*#__PURE__*/React.createElement("svg", c, /*#__PURE__*/React.createElement("path", {
        d: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
      }), /*#__PURE__*/React.createElement("polyline", {
        points: "22,6 12,13 2,6"
      }));
    default:
      return null;
  }
};

// --- Pill / Badge --------------------------------------------------
const Pill = ({
  children,
  tone = "neutral",
  soft = true,
  dot = false,
  style
}) => {
  const styles = {
    neutral: {
      color: "var(--ink-2)",
      bg: "var(--paper-2)",
      line: "var(--hairline)"
    },
    success: {
      color: "var(--income)",
      bg: "var(--income-bg)",
      line: "transparent"
    },
    danger: {
      color: "var(--expense)",
      bg: "var(--expense-bg)",
      line: "transparent"
    },
    warning: {
      color: "var(--warning)",
      bg: "var(--warning-bg)",
      line: "transparent"
    },
    info: {
      color: "var(--info)",
      bg: "var(--info-bg)",
      line: "transparent"
    },
    primary: {
      color: "var(--primary)",
      bg: "var(--primary-soft)",
      line: "transparent"
    }
  }[tone] || {
    color: "var(--ink-2)",
    bg: "var(--paper-2)"
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 11.5,
      fontWeight: 500,
      letterSpacing: ".01em",
      color: styles.color,
      background: soft ? styles.bg : "transparent",
      border: soft ? `1px solid ${styles.line}` : `1px solid ${styles.color}`,
      whiteSpace: "nowrap",
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 6,
      background: styles.color
    }
  }), children);
};

// --- Category chip -------------------------------------------------
const CategoryChip = ({
  category,
  size = "md"
}) => {
  if (!category) return /*#__PURE__*/React.createElement(Pill, {
    tone: "neutral"
  }, "Sans cat\xE9gorie");
  const pad = size === "sm" ? "2px 8px 2px 6px" : "3px 10px 3px 6px";
  const fs = size === "sm" ? 11.5 : 12;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: pad,
      borderRadius: 999,
      background: "var(--paper-2)",
      border: "1px solid var(--hairline)",
      color: "var(--ink)",
      fontSize: fs,
      fontWeight: 500,
      whiteSpace: "nowrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 8,
      background: category.color,
      display: "inline-block"
    }
  }), category.name);
};

// --- Button --------------------------------------------------------
const Button = ({
  children,
  variant = "ghost",
  size = "md",
  icon,
  iconRight,
  onClick,
  full,
  style,
  type = "button",
  disabled
}) => {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: size === "sm" ? 28 : size === "lg" ? 40 : 34,
    padding: size === "sm" ? "0 10px" : size === "lg" ? "0 18px" : "0 14px",
    borderRadius: size === "sm" ? 6 : 8,
    fontSize: size === "sm" ? 12.5 : 13.5,
    fontWeight: 500,
    transition: "all .15s ease",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    width: full ? "100%" : undefined,
    fontFamily: "var(--font-sans)",
    letterSpacing: "-.005em"
  };
  const variants = {
    primary: {
      background: "var(--primary)",
      color: "var(--primary-ink)",
      border: "1px solid var(--primary)"
    },
    secondary: {
      background: "var(--card)",
      color: "var(--ink)",
      border: "1px solid var(--hairline-2)"
    },
    ghost: {
      background: "transparent",
      color: "var(--ink-2)",
      border: "1px solid transparent"
    },
    danger: {
      background: "transparent",
      color: "var(--expense)",
      border: "1px solid var(--expense-bg)"
    },
    link: {
      background: "transparent",
      color: "var(--primary)",
      border: "1px solid transparent",
      padding: 0,
      height: "auto"
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: {
      ...base,
      ...variants[variant],
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: size === "sm" ? 13 : 15
  }), children, iconRight && /*#__PURE__*/React.createElement(Icon, {
    name: iconRight,
    size: size === "sm" ? 13 : 15
  }));
};

// --- Card ----------------------------------------------------------
const Card = ({
  children,
  padding = 20,
  style,
  onClick
}) => /*#__PURE__*/React.createElement("div", {
  onClick: onClick,
  style: {
    background: "var(--card)",
    border: "1px solid var(--hairline)",
    borderRadius: 14,
    padding,
    boxShadow: "var(--shadow-1)",
    cursor: onClick ? "pointer" : "default",
    ...style
  }
}, children);

// --- Section header -----------------------------------------------
const SectionHeader = ({
  overline,
  title,
  subtitle,
  right
}) => /*#__PURE__*/React.createElement("div", {
  className: "between",
  style: {
    marginBottom: 16,
    alignItems: "flex-end"
  }
}, /*#__PURE__*/React.createElement("div", null, overline && /*#__PURE__*/React.createElement("div", {
  className: "overline",
  style: {
    marginBottom: 6
  }
}, overline), /*#__PURE__*/React.createElement("div", {
  className: "serif",
  style: {
    fontSize: 28,
    lineHeight: 1.1,
    letterSpacing: "-.01em",
    color: "var(--ink)"
  }
}, title), subtitle && /*#__PURE__*/React.createElement("div", {
  style: {
    color: "var(--ink-3)",
    marginTop: 4,
    fontSize: 13.5
  }
}, subtitle)), right);

// --- Avatar --------------------------------------------------------
const Avatar = ({
  initials,
  size = 28,
  tint
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    width: size,
    height: size,
    borderRadius: size,
    background: tint || "var(--primary-soft)",
    color: "var(--primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size * 0.42,
    fontWeight: 600,
    letterSpacing: ".02em",
    border: "1px solid var(--hairline)"
  }
}, initials);

// --- Tabs ----------------------------------------------------------
const Tabs = ({
  items,
  active,
  onChange
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: "inline-flex",
    padding: 3,
    background: "var(--paper-2)",
    borderRadius: 9,
    border: "1px solid var(--hairline)"
  }
}, items.map(it => /*#__PURE__*/React.createElement("button", {
  key: it.id,
  onClick: () => onChange(it.id),
  style: {
    height: 28,
    padding: "0 12px",
    borderRadius: 6,
    background: active === it.id ? "var(--card)" : "transparent",
    color: active === it.id ? "var(--ink)" : "var(--ink-3)",
    fontSize: 12.5,
    fontWeight: 500,
    boxShadow: active === it.id ? "0 1px 2px rgba(0,0,0,.06)" : "none",
    transition: "all .15s ease"
  }
}, it.label)));

// --- Bar chart (horizontal) ---------------------------------------
const HBar = ({
  value,
  max,
  color = "var(--primary)",
  bg = "var(--paper-2)",
  height = 6
}) => {
  const pct = Math.min(1, Math.max(0, value / max));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      height,
      background: bg,
      borderRadius: height,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${pct * 100}%`,
      height: "100%",
      background: color,
      borderRadius: height,
      transition: "width .3s ease"
    }
  }));
};

// --- Progress over-budget aware -----------------------------------
const BudgetBar = ({
  spent,
  planned,
  height = 8
}) => {
  const ratio = planned === 0 ? 0 : spent / planned;
  const over = ratio > 1;
  const pct = Math.min(1, ratio) * 100;
  const color = over ? "var(--expense)" : ratio > 0.85 ? "var(--warning)" : "var(--primary)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      height,
      background: "var(--paper-2)",
      borderRadius: height,
      overflow: "hidden",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${pct}%`,
      height: "100%",
      background: color,
      transition: "width .3s ease"
    }
  }));
};

// --- Donut chart ---------------------------------------------------
const Donut = ({
  data,
  size = 200,
  thickness = 24,
  centerLabel,
  centerSub
}) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: size,
      height: size
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`,
    style: {
      transform: "rotate(-90deg)"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--paper-2)",
    strokeWidth: thickness
  }), data.map((d, i) => {
    const len = d.value / total * C;
    const seg = /*#__PURE__*/React.createElement("circle", {
      key: i,
      cx: size / 2,
      cy: size / 2,
      r: r,
      fill: "none",
      stroke: d.color,
      strokeWidth: thickness,
      strokeDasharray: `${len} ${C - len}`,
      strokeDashoffset: -offset,
      style: {
        transition: "all .3s ease"
      }
    });
    offset += len;
    return seg;
  })), (centerLabel !== undefined || centerSub) && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: 4,
      padding: "0 8px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 28,
      lineHeight: 1,
      color: "var(--ink)",
      whiteSpace: "nowrap"
    }
  }, centerLabel), centerSub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--ink-3)",
      whiteSpace: "nowrap"
    }
  }, centerSub)));
};

// --- Sparkline -----------------------------------------------------
const Sparkline = ({
  points,
  width = 200,
  height = 48,
  color = "var(--primary)",
  fill = "var(--primary-soft)"
}) => {
  if (!points.length) return null;
  const vals = points.map(p => typeof p === "number" ? p : p.value);
  const max = Math.max(1, ...vals);
  const w = width,
    h = height;
  const stepX = w / Math.max(1, points.length - 1);
  const path = vals.map((v, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${h - v / max * (h - 4) - 2}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: h,
    viewBox: `0 0 ${w} ${h}`
  }, /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: fill,
    opacity: "0.35"
  }), /*#__PURE__*/React.createElement("path", {
    d: path,
    fill: "none",
    stroke: color,
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }));
};

// --- Vertical bar mini-chart --------------------------------------
const MiniBars = ({
  points,
  width = 200,
  height = 56,
  color = "var(--primary)",
  highlightLast
}) => {
  const vals = points.map(p => typeof p === "number" ? p : p.value);
  const max = Math.max(1, ...vals);
  const w = width,
    h = height;
  const gap = 1.2;
  const barW = (w - gap * (vals.length - 1)) / vals.length;
  return /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: h,
    viewBox: `0 0 ${w} ${h}`
  }, vals.map((v, i) => {
    const barH = v / max * (h - 4);
    return /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: i * (barW + gap),
      y: h - barH,
      width: barW,
      height: barH || 1,
      rx: Math.min(barW / 2, 1.5),
      fill: highlightLast && i === vals.length - 1 ? "var(--ink)" : color,
      opacity: 0.85
    });
  }));
};

// --- Input ---------------------------------------------------------
const Input = ({
  icon,
  ...props
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    background: "var(--card)",
    border: "1px solid var(--hairline-2)",
    borderRadius: 8,
    height: 36,
    paddingLeft: icon ? 32 : 12,
    paddingRight: 12
  }
}, icon && /*#__PURE__*/React.createElement("span", {
  style: {
    position: "absolute",
    left: 10,
    color: "var(--ink-3)",
    display: "flex"
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: icon,
  size: 15
})), /*#__PURE__*/React.createElement("input", _extends({}, props, {
  style: {
    border: 0,
    outline: 0,
    width: "100%",
    background: "transparent",
    fontSize: 13.5,
    color: "var(--ink)",
    fontFamily: "var(--font-sans)"
  }
})));

// --- Toggle switch -------------------------------------------------
const Switch = ({
  checked,
  onChange,
  size = 36
}) => /*#__PURE__*/React.createElement("button", {
  onClick: () => onChange?.(!checked),
  "aria-pressed": checked,
  style: {
    width: size,
    height: size * 0.56,
    borderRadius: 999,
    background: checked ? "var(--primary)" : "var(--paper-3)",
    border: "1px solid var(--hairline-2)",
    position: "relative",
    transition: "background .2s ease",
    padding: 0
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    position: "absolute",
    top: 1,
    left: checked ? size - size * 0.56 + 1 : 1,
    width: size * 0.56 - 4,
    height: size * 0.56 - 4,
    borderRadius: 999,
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,.2)",
    transition: "left .2s ease"
  }
}));
Object.assign(window, {
  fmtEUR,
  fmtEURcompact,
  fmtDate,
  fmtDateLong,
  Icon,
  Pill,
  CategoryChip,
  Button,
  Card,
  SectionHeader,
  Avatar,
  Tabs,
  HBar,
  BudgetBar,
  Donut,
  Sparkline,
  MiniBars,
  Input,
  Switch
});