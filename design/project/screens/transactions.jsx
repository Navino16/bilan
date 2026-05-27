/* Transactions screen with detail panel + create-rule dialog */

const TransactionsScreen = ({ device, monthIdx, density = "cozy", scope }) => {
  const isMobile = device === "mobile";
  const [selectedId, setSelectedId] = React.useState("t06"); // pre-selected for prototype
  const [showRuleDialog, setShowRuleDialog] = React.useState(false);
  const [filterCat, setFilterCat] = React.useState("all");
  const [filterType, setFilterType] = React.useState("all");

  let txs = TRANSACTIONS.filter(t => t.date.startsWith("2026-05"));
  if (filterCat !== "all")  txs = txs.filter(t => t.categoryId === filterCat);
  if (filterType === "in")  txs = txs.filter(t => t.amount > 0);
  if (filterType === "out") txs = txs.filter(t => t.amount < 0);

  const grouped = groupByDay(txs);
  const selected = txs.find(t => t.id === selectedId) || TRANSACTIONS.find(t => t.id === selectedId);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* LIST PANE */}
      <div style={{ flex: 1, minWidth: 0, overflow: "auto" }} className="scrollbar">
        <div style={{ padding: isMobile ? "16px 16px 12px" : "32px 32px 16px" }}>
          {!isMobile && (
            <div className="between" style={{ marginBottom: 18 }}>
              <div>
                <div className="overline" style={{ marginBottom: 4 }}>Mai 2026 · {txs.length} opérations</div>
                <div className="serif" style={{ fontSize: 32, lineHeight: 1.1 }}>Transactions</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" icon="filter" size="sm">Filtres</Button>
                <Button variant="secondary" icon="download" size="sm">Exporter</Button>
                <Button variant="primary" icon="plus" size="sm">Saisir</Button>
              </div>
            </div>
          )}

          {/* Filter rail */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <Tabs items={[
              { id: "all", label: "Toutes" },
              { id: "in",  label: "Entrées" },
              { id: "out", label: "Sorties" },
            ]} active={filterType} onChange={setFilterType} />
            {!isMobile && (
              <>
                <span style={{ width: 1, height: 18, background: "var(--hairline)", margin: "0 4px" }} />
                <CategoryFilter value={filterCat} onChange={setFilterCat} />
                <Pill tone="neutral">28 résultats</Pill>
                <div style={{ flex: 1 }} />
                <Button variant="ghost" size="sm" icon="sort">Trier · Date ↓</Button>
              </>
            )}
          </div>
        </div>

        {/* TABLE */}
        <div>
          {!isMobile && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto auto auto auto",
              gap: 12,
              padding: "10px 32px",
              borderTop: "1px solid var(--hairline)",
              borderBottom: "1px solid var(--hairline)",
              fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)",
              background: "var(--paper-2)",
            }}>
              <span>Date</span>
              <span>Libellé</span>
              <span>Catégorie</span>
              <span>Compte</span>
              <span>Type</span>
              <span style={{ textAlign: "right" }}>Montant</span>
            </div>
          )}

          {grouped.map(group => (
            <div key={group.date}>
              <div style={{
                padding: isMobile ? "12px 16px 6px" : "12px 32px 8px",
                fontSize: 11.5, color: "var(--ink-3)",
                textTransform: "capitalize", letterSpacing: ".02em",
                background: "var(--paper)",
                position: "sticky", top: 0, zIndex: 2,
                borderBottom: "1px solid var(--hairline)",
                display: "flex", justifyContent: "space-between",
              }}>
                <span>{fmtDateLong(group.date)}</span>
                <span className="num">{fmtEUR(group.total, { sign: group.total > 0 })}</span>
              </div>
              {group.txs.map(t => (
                <TxRowFull
                  key={t.id} tx={t}
                  density={density}
                  selected={t.id === selectedId}
                  compact={isMobile}
                  onClick={() => setSelectedId(t.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* DETAIL PANE — desktop side panel; mobile bottom sheet */}
      {!isMobile && selected && (
        <TxDetail
          tx={selected}
          onClose={() => setSelectedId(null)}
          onChangeCategory={() => setShowRuleDialog(true)}
        />
      )}
      {isMobile && selected && (
        <TxDetailMobile
          tx={selected}
          onClose={() => setSelectedId(null)}
          onChangeCategory={() => setShowRuleDialog(true)}
        />
      )}

      {showRuleDialog && (
        <RuleSuggestionDialog
          tx={selected}
          onClose={() => setShowRuleDialog(false)}
        />
      )}
    </div>
  );
};

// ---- Density picker ----
const DensityPicker = () => {
  const [d, setD] = React.useState(document.documentElement.getAttribute("data-density") || "cozy");
  const set = (v) => { setD(v); document.documentElement.setAttribute("data-density", v); };
  return (
    <Tabs
      items={[
        { id: "compact", label: "Dense" },
        { id: "cozy",    label: "Confort" },
        { id: "roomy",   label: "Spacieux" },
      ]}
      active={d}
      onChange={set}
    />
  );
};

const CategoryFilter = ({ value, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const current = value === "all" ? "Toutes catégories" : findCat(value)?.name;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        height: 30, padding: "0 10px",
        background: "var(--card)", border: "1px solid var(--hairline)",
        borderRadius: 7, display: "flex", alignItems: "center", gap: 6,
        fontSize: 12.5, color: "var(--ink-2)",
      }}>
        <Icon name="tag" size={13} /> {current}
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: 34, left: 0, minWidth: 180,
          background: "var(--card)", border: "1px solid var(--hairline)",
          borderRadius: 10, padding: 4,
          boxShadow: "var(--shadow-2)", zIndex: 50,
          maxHeight: 320, overflow: "auto",
        }} className="scrollbar">
          <button onClick={() => { onChange("all"); setOpen(false); }} style={dropItem(value === "all")}>Toutes catégories</button>
          {CATEGORIES.filter(c => !c.parentId).map(c => (
            <button key={c.id} onClick={() => { onChange(c.id); setOpen(false); }} style={dropItem(value === c.id)}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: c.color }} /> {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const dropItem = (active) => ({
  width: "100%", padding: "7px 8px",
  display: "flex", alignItems: "center", gap: 8,
  background: active ? "var(--paper-2)" : "transparent",
  borderRadius: 6, fontSize: 13, color: "var(--ink)", textAlign: "left",
});

// --- Row -----------------------------------------------------------
const TxRowFull = ({ tx, density, selected, compact, onClick }) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  const py = density === "compact" ? 6 : density === "roomy" ? 14 : 10;
  if (compact) {
    return (
      <button onClick={onClick} style={{
        width: "100%", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center",
        padding: "10px 16px", borderBottom: "1px solid var(--hairline)",
        background: selected ? "var(--paper-2)" : "transparent", textAlign: "left",
      }}>
        <span style={{
          width: 30, height: 30, borderRadius: 8,
          background: cat.color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, opacity: 0.92,
        }}>{cat.icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.label}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{cat.name} · {acc?.name}</div>
        </div>
        <span className="num" style={{ fontSize: 14, fontWeight: 500, color: tx.amount > 0 ? "var(--income)" : "var(--ink)" }}>
          {fmtEUR(tx.amount, { sign: tx.amount > 0 })}
        </span>
      </button>
    );
  }
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "grid",
      gridTemplateColumns: "70px 1fr 200px 160px 90px 130px",
      gap: 12, alignItems: "center",
      padding: `${py}px 32px`,
      borderBottom: "1px solid var(--hairline)",
      background: selected ? "var(--primary-soft)" : "transparent",
      textAlign: "left",
      transition: "background .12s ease",
    }}>
      <span className="num" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{fmtDate(tx.date)}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 6, flexShrink: 0,
          background: cat.color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, opacity: 0.92,
        }}>{cat.icon}</span>
        <span style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: selected ? "var(--ink)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 8 }}>
            {tx.label}
            {tx.linked && <Icon name="link" size={11} />}
          </div>
          {density === "roomy" && <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{tx.rawLabel}</div>}
        </span>
      </span>
      <CategoryChip category={cat} size="sm" />
      <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{acc?.name}</span>
      <Pill tone="neutral" style={{ height: 20, fontSize: 10.5 }}>{labelType(tx.type)}</Pill>
      <span className="num" style={{ fontSize: 14, textAlign: "right", fontWeight: 500, color: tx.amount > 0 ? "var(--income)" : "var(--ink)" }}>
        {fmtEUR(tx.amount, { sign: tx.amount > 0 })}
      </span>
    </button>
  );
};

const labelType = (t) => ({ CARD: "Carte", TRANSFER: "Virement", DIRECT_DEBIT: "Prélèvement", CHEQUE: "Chèque", ATM: "Retrait" }[t] || "Autre");

// --- Group by day -------------------------------------------------
const groupByDay = (txs) => {
  const m = new Map();
  for (const t of txs) {
    if (!m.has(t.date)) m.set(t.date, []);
    m.get(t.date).push(t);
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, txs]) => ({ date, txs, total: txs.reduce((s, t) => s + t.amount, 0) }));
};

// --- Detail panel (desktop) ---------------------------------------
const TxDetail = ({ tx, onClose, onChangeCategory }) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  return (
    <aside style={{
      width: 380, flexShrink: 0,
      borderLeft: "1px solid var(--hairline)",
      background: "var(--card-2)",
      overflow: "auto",
    }} className="scrollbar">
      <div style={{ padding: 24, borderBottom: "1px solid var(--hairline)" }}>
        <div className="between" style={{ marginBottom: 16 }}>
          <div className="overline">Transaction</div>
          <button onClick={onClose} style={{ color: "var(--ink-3)" }}><Icon name="x" size={16} /></button>
        </div>
        <div className="num serif" style={{ fontSize: 36, color: tx.amount > 0 ? "var(--income)" : "var(--ink)", lineHeight: 1, marginBottom: 6 }}>
          {fmtEUR(tx.amount, { sign: tx.amount > 0 })}
        </div>
        <div style={{ fontSize: 14, color: "var(--ink)" }}>{tx.label}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{fmtDateLong(tx.date)}</div>
      </div>

      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Catégorie">
          <button onClick={onChangeCategory} style={{
            width: "100%", padding: "10px 12px",
            background: "var(--card)", border: "1px solid var(--hairline-2)",
            borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
            fontSize: 13.5,
          }}>
            <span style={{ width: 10, height: 10, borderRadius: 10, background: cat.color }} />
            <span style={{ flex: 1, textAlign: "left" }}>{cat.name}</span>
            <Icon name="chevron-down" size={14} />
          </button>
        </Field>

        <Field label="Compte">
          <div className="row" style={{ padding: "10px 12px", background: "var(--card)", border: "1px solid var(--hairline-2)", borderRadius: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: acc.color }} />
            <span style={{ fontSize: 13.5 }}>{acc.name}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{acc.bank}</span>
          </div>
        </Field>

        <Field label="Type">
          <Pill tone="neutral">{labelType(tx.type)}</Pill>
        </Field>

        <Field label="Libellé d'origine">
          <div style={{ padding: "10px 12px", background: "var(--paper-2)", border: "1px solid var(--hairline)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)" }}>{tx.rawLabel}</div>
        </Field>

        <Field label="Note">
          <textarea
            defaultValue={tx.note}
            placeholder="Ajouter une note privée…"
            style={{
              width: "100%", minHeight: 60, padding: "10px 12px",
              background: "var(--card)", border: "1px solid var(--hairline-2)",
              borderRadius: 8, fontSize: 13.5, fontFamily: "var(--font-sans)", color: "var(--ink)",
              resize: "vertical", outline: "none",
            }}
          />
        </Field>

        <div style={{ height: 1, background: "var(--hairline)" }} />

        <div className="overline">Actions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ActionRow icon="link"     label="Lier à une autre transaction" />
          <ActionRow icon="target"   label="Affecter à un budget" />
          <ActionRow icon="external" label="Voir l'import d'origine" />
          <ActionRow icon="trash"    label="Supprimer" danger />
        </div>
      </div>
    </aside>
  );
};

const Field = ({ label, children }) => (
  <div>
    <div className="overline" style={{ marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);

const ActionRow = ({ icon, label, danger }) => (
  <button style={{
    width: "100%", padding: "10px 12px",
    background: "transparent", border: "1px solid var(--hairline)",
    borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
    fontSize: 13, color: danger ? "var(--expense)" : "var(--ink-2)", textAlign: "left",
  }}>
    <Icon name={icon} size={15} />
    {label}
    <span style={{ flex: 1 }} />
    <Icon name="chevron-right" size={14} />
  </button>
);

// --- Detail (mobile bottom sheet) --------------------------------
const TxDetailMobile = ({ tx, onClose, onChangeCategory }) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(20,17,13,.35)",
      display: "flex", alignItems: "flex-end",
      zIndex: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxHeight: "85%",
        background: "var(--card)", borderRadius: "20px 20px 0 0",
        padding: 20, overflow: "auto",
      }} className="scrollbar">
        <div style={{ width: 36, height: 4, borderRadius: 4, background: "var(--hairline-2)", margin: "0 auto 14px" }} />
        <div className="num serif" style={{ fontSize: 32, color: tx.amount > 0 ? "var(--income)" : "var(--ink)" }}>
          {fmtEUR(tx.amount, { sign: tx.amount > 0 })}
        </div>
        <div style={{ fontSize: 14, color: "var(--ink)", marginTop: 4 }}>{tx.label}</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 16 }}>{fmtDateLong(tx.date)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Catégorie">
            <button onClick={onChangeCategory} style={{
              width: "100%", padding: "10px 12px",
              background: "var(--paper-2)", border: "1px solid var(--hairline)",
              borderRadius: 8, display: "flex", alignItems: "center", gap: 10, fontSize: 13.5,
            }}>
              <span style={{ width: 10, height: 10, borderRadius: 10, background: cat.color }} />
              <span style={{ flex: 1, textAlign: "left" }}>{cat.name}</span>
              <Icon name="chevron-down" size={14} />
            </button>
          </Field>
          <Field label="Compte"><div style={{ fontSize: 13 }}>{acc.name} · {acc.bank}</div></Field>
          <Field label="Libellé d'origine"><div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)" }}>{tx.rawLabel}</div></Field>
        </div>
      </div>
    </div>
  );
};

// --- Create rule dialog ------------------------------------------
const RuleSuggestionDialog = ({ tx, onClose }) => {
  const cat = findCat(tx.categoryId);
  const token = tx.rawLabel.split(/\s+/).find(t => t.length >= 4) || tx.rawLabel.split(/\s+/)[0];
  const [match, setMatch] = React.useState("CONTAINS");
  const [scope, setScope] = React.useState("user");
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(20,17,13,.45)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 30, padding: 24,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--card)", border: "1px solid var(--hairline)",
        borderRadius: 16, width: 440, maxWidth: "100%",
        boxShadow: "var(--shadow-3)", overflow: "hidden",
      }}>
        <div style={{ padding: "20px 24px 12px" }}>
          <div className="overline" style={{ marginBottom: 8 }}>Apprentissage</div>
          <div className="serif" style={{ fontSize: 24, lineHeight: 1.2, color: "var(--ink)" }}>
            Créer une règle pour les transactions similaires&#8239;?
          </div>
          <div style={{ marginTop: 8, color: "var(--ink-3)", fontSize: 13 }}>
            Vous venez de classer <strong style={{ color: "var(--ink)" }}>« {tx.label} »</strong> dans <CategoryChip category={cat} size="sm" />.
            Bilan peut classer automatiquement les futures transactions correspondantes.
          </div>
        </div>

        <div style={{ padding: "0 24px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Motif">
            <div style={{
              padding: "10px 12px", background: "var(--paper-2)", borderRadius: 8,
              fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink)",
              border: "1px dashed var(--hairline-2)",
            }}>{token}</div>
          </Field>
          <Field label="Type de correspondance">
            <Tabs items={[
              { id: "CONTAINS", label: "Contient" },
              { id: "STARTS_WITH", label: "Commence par" },
              { id: "EXACT", label: "Égal à" },
              { id: "REGEX", label: "Regex" },
            ]} active={match} onChange={setMatch} />
          </Field>
          <Field label="Portée">
            <Tabs items={[
              { id: "user", label: "Mes données seulement" },
              { id: "group", label: "Foyer Dupont" },
            ]} active={scope} onChange={setScope} />
          </Field>
          <div style={{
            padding: "10px 12px", background: "var(--info-bg)",
            borderRadius: 8, fontSize: 12.5, color: "var(--info)",
            display: "flex", gap: 8, alignItems: "flex-start",
          }}>
            <Icon name="info" size={14} />
            <span><strong>4 transactions</strong> existantes correspondent. Elles ne seront pas reclassées automatiquement.</span>
          </div>
        </div>

        <div style={{
          padding: "12px 24px", background: "var(--paper)",
          borderTop: "1px solid var(--hairline)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <Button variant="ghost" onClick={onClose}>Non, merci</Button>
          <Button variant="primary" icon="check">Créer la règle</Button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { TransactionsScreen });
