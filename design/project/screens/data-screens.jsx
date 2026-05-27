/* Budgets, Accounts, Categories, Links, Groups screens */

// ============== BUDGETS ==========================================
const BudgetsScreen = ({ device, monthIdx, budgetViz = "bar", scope }) => {
  const isMobile = device === "mobile";
  const [activeBudgetId, setActiveBudgetId] = React.useState("b_may");
  const ctx = React.useContext(window.AppContext);
  const b = BUDGETS.find(x => x.id === activeBudgetId);
  const total = b.lines.reduce((s, l) => s + l.spent, 0);
  const planned = b.lines.reduce((s, l) => s + l.planned, 0);

  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {!isMobile && (
        <div className="between" style={{ marginBottom: 24, alignItems: "flex-end" }}>
          <div>
            <div className="overline" style={{ marginBottom: 6 }}>Budgets · {scope === "household" ? "Foyer" : "Personnel"}</div>
            <div className="serif" style={{ fontSize: 32, lineHeight: 1.1 }}>Mes budgets</div>
            <div style={{ color: "var(--ink-3)", marginTop: 4, fontSize: 13.5 }}>Plan + suivi pour chaque catégorie ce mois.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" icon="download" size="sm">Exporter</Button>
            <Button variant="primary" icon="plus" size="sm" onClick={() => ctx.setModal("addBudget")}>Nouveau budget</Button>
          </div>
        </div>
      )}

      {/* budget tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {BUDGETS.map(bd => (
          <button key={bd.id} onClick={() => setActiveBudgetId(bd.id)} style={{
            padding: "8px 14px", borderRadius: 999,
            background: activeBudgetId === bd.id ? "var(--ink)" : "var(--card)",
            color: activeBudgetId === bd.id ? "var(--paper)" : "var(--ink-2)",
            border: "1px solid " + (activeBudgetId === bd.id ? "var(--ink)" : "var(--hairline-2)"),
            fontSize: 13, fontWeight: 500,
          }}>{bd.name} {bd.scope === "group" && <span style={{ opacity: 0.7, marginLeft: 6 }}>· foyer</span>}</button>
        ))}
      </div>

      {/* HERO */}
      <Card padding={isMobile ? 20 : 28}>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 16 : 28 }}>
          <div style={{ flex: 1 }}>
            <div className="overline">Du 1 au 31 mai 2026</div>
            <div className="serif" style={{ fontSize: 30, lineHeight: 1.1, margin: "4px 0 12px" }}>{b.name}</div>
            <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
              <div>
                <div className="overline" style={{ marginBottom: 2 }}>Dépensé</div>
                <div className="num serif" style={{ fontSize: 28, color: total > planned ? "var(--expense)" : "var(--ink)" }}>{fmtEUR(total, { decimals: 0 })}</div>
              </div>
              <div>
                <div className="overline" style={{ marginBottom: 2 }}>Plafond</div>
                <div className="num" style={{ fontSize: 22, color: "var(--ink-2)" }}>{fmtEUR(planned, { decimals: 0 })}</div>
              </div>
              <div>
                <div className="overline" style={{ marginBottom: 2 }}>Reste</div>
                <div className="num serif" style={{ fontSize: 28, color: total <= planned ? "var(--income)" : "var(--expense)" }}>{fmtEUR(planned - total, { sign: true, decimals: 0 })}</div>
              </div>
            </div>
            <BudgetBar spent={total} planned={planned} height={10} />
            <div className="between" style={{ marginTop: 8, fontSize: 12, color: "var(--ink-3)" }}>
              <span>{Math.round((total / planned) * 100)} % du budget consommé</span>
              <span>jour 26/31 · projection {fmtEUR((total / 26) * 31, { decimals: 0 })}</span>
            </div>
          </div>

          {!isMobile && (
            <div style={{ width: 220, flexShrink: 0 }}>
              <Donut
                size={200}
                thickness={22}
                data={b.lines.map(l => ({ value: l.spent, color: findCat(l.categoryId).color }))}
                centerLabel={`${Math.round((total / planned) * 100)} %`}
                centerSub="consommé"
              />
            </div>
          )}
        </div>
      </Card>

      {/* lines */}
      <Card padding={0} style={{ marginTop: 16 }}>
        <div className="between" style={{ padding: "18px 24px 12px" }}>
          <div className="serif" style={{ fontSize: 18 }}>Lignes du budget</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Visualisation&#8239;: <span style={{ color: "var(--ink-2)", textTransform: "capitalize" }}>{
            { bar: "barre", gauge: "jauge", ring: "anneau", spark: "courbe" }[budgetViz]
          }</span></div>
        </div>
        {b.lines.map(l => {
          const cat = findCat(l.categoryId);
          const ratio = l.spent / l.planned;
          const over = ratio > 1;
          return (
            <div key={l.id} style={{ padding: "16px 24px", borderTop: "1px solid var(--hairline)" }}>
              <div className="between" style={{ marginBottom: 8 }}>
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 10, background: cat.color }} />
                  <span style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{cat.name}</span>
                  {over && <Pill tone="danger">+ {fmtEUR(l.spent - l.planned, { decimals: 0 })}</Pill>}
                  {ratio >= 0.85 && !over && <Pill tone="warning">Proche du plafond</Pill>}
                </div>
                <div className="num" style={{ fontSize: 14, color: over ? "var(--expense)" : "var(--ink)" }}>
                  {fmtEUR(l.spent)} <span style={{ color: "var(--ink-3)" }}> / {fmtEUR(l.planned)}</span>
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                {budgetViz === "bar"   && <BudgetBar spent={l.spent} planned={l.planned} height={10} />}
                {budgetViz === "gauge" && <BudgetGauge spent={l.spent} planned={l.planned} color={cat.color} />}
                {budgetViz === "ring"  && <BudgetRingLine spent={l.spent} planned={l.planned} color={cat.color} />}
                {budgetViz === "spark" && <BudgetSpark spent={l.spent} planned={l.planned} color={cat.color} />}
              </div>
              <div className="between" style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink-3)" }}>
                <span>{Math.round(ratio * 100)} % · {(l.spent / 26).toFixed(0)} € / jour moyen</span>
                <button style={{ color: "var(--ink-3)", fontSize: 11.5, textDecoration: "underline", textDecorationStyle: "dotted" }}>Affecter une transaction</button>
              </div>
            </div>
          );
        })}
        <div style={{ padding: 16, borderTop: "1px solid var(--hairline)", display: "flex", justifyContent: "center" }}>
          <Button variant="ghost" icon="plus" size="sm">Ajouter une ligne</Button>
        </div>
      </Card>
    </div>
  );
};

// ============== ACCOUNTS =========================================
const AccountsScreen = ({ device }) => {
  const isMobile = device === "mobile";
  const [showShare, setShowShare] = React.useState(false);
  const ctx = React.useContext(window.AppContext);
  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {!isMobile && (
        <div className="between" style={{ marginBottom: 24 }}>
          <div>
            <div className="overline" style={{ marginBottom: 4 }}>Patrimoine</div>
            <div className="serif" style={{ fontSize: 32, lineHeight: 1.1 }}>Comptes</div>
          </div>
          <Button variant="primary" icon="plus" size="sm" onClick={() => ctx.setModal("addAccount")}>Ajouter un compte</Button>
        </div>
      )}

      {/* Total */}
      <Card padding={isMobile ? 18 : 24} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="overline">Solde global</div>
            <div className="num serif" style={{ fontSize: 40, lineHeight: 1, marginTop: 4 }}>
              {fmtEUR(ACCOUNTS.reduce((s, a) => s + a.balance, 0), { decimals: 2 })}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <Pill tone="success" dot>+ 1 240 € ce mois</Pill>
        </div>
        <div style={{ marginTop: 14, height: 12, display: "flex", borderRadius: 6, overflow: "hidden" }}>
          {ACCOUNTS.map((a, i) => {
            const total = ACCOUNTS.reduce((s, x) => s + x.balance, 0);
            return <div key={i} title={a.name} style={{ flex: a.balance / total, background: a.color }} />;
          })}
        </div>
        <div className="row" style={{ marginTop: 8, gap: 14, flexWrap: "wrap" }}>
          {ACCOUNTS.map(a => (
            <div key={a.id} className="row" style={{ gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: a.color }} />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{a.name}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* List */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
        {ACCOUNTS.map(a => (
          <Card key={a.id} padding={20}>
            <div className="between" style={{ marginBottom: 12 }}>
              <div className="row">
                <span style={{ width: 6, height: 30, borderRadius: 3, background: a.color }} />
                <div>
                  <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{a.bank} · {labelAccType(a.type)}</div>
                </div>
              </div>
              <button style={{ color: "var(--ink-3)", padding: 4 }}><Icon name="more" size={16} /></button>
            </div>
            <div className="num serif" style={{ fontSize: 26, color: a.balance < 0 ? "var(--expense)" : "var(--ink)" }}>
              {fmtEUR(a.balance)}
            </div>
            {a.iban && <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>{a.iban}</div>}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: 8 }}>
              {a.sharedWith.length > 0 ? (
                <>
                  <Pill tone="primary" soft dot>Partagé · {a.permission === "WRITE" ? "écriture" : "lecture"}</Pill>
                  <div style={{ display: "flex", marginLeft: 4 }}>
                    {HOUSEHOLD.members.map((m, i) => (
                      <div key={m.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                        <Avatar initials={m.initials} size={22} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <Pill tone="neutral">Privé</Pill>
              )}
              <div style={{ flex: 1 }} />
              <Button variant="ghost" size="sm" icon="share" onClick={() => setShowShare(a.id)}>Partager</Button>
            </div>
          </Card>
        ))}
      </div>

      {showShare && <ShareDialog account={ACCOUNTS.find(a => a.id === showShare)} onClose={() => setShowShare(false)} />}
    </div>
  );
};

const labelAccType = (t) => ({ CHECKING: "Compte courant", SAVINGS: "Livret épargne", CREDIT: "Crédit", OTHER: "Autre" }[t]);

const ShareDialog = ({ account, onClose }) => {
  const [perm, setPerm] = React.useState(account.permission || "READ");
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 30,
      background: "rgba(20,17,13,.45)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--card)", border: "1px solid var(--hairline)",
        borderRadius: 16, width: 460, maxWidth: "100%", boxShadow: "var(--shadow-3)",
      }}>
        <div style={{ padding: "20px 24px 16px" }}>
          <div className="overline" style={{ marginBottom: 6 }}>Partage de compte</div>
          <div className="serif" style={{ fontSize: 22 }}>Partager « {account.name} »</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>Les membres pourront consulter — et selon la permission — modifier les transactions de ce compte.</div>
        </div>
        <div style={{ padding: "0 24px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Groupe">
            <div style={{ padding: "10px 12px", background: "var(--paper-2)", border: "1px solid var(--hairline)", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="users" size={14} />
              <span style={{ fontSize: 13.5 }}>Foyer Dupont</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>2 membres</span>
            </div>
          </Field>
          <Field label="Permission">
            <Tabs items={[
              { id: "READ", label: "Lecture seule" },
              { id: "WRITE", label: "Lecture + écriture" },
            ]} active={perm} onChange={setPerm} />
          </Field>
          <div style={{ padding: 12, background: "var(--warning-bg)", borderRadius: 8, fontSize: 12, color: "var(--warning)", display: "flex", gap: 8 }}>
            <Icon name="alert" size={14} />
            <span>Les transactions affectées à un budget partagé restent visibles par le groupe, même si le compte est privé.</span>
          </div>
        </div>
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--hairline)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" icon="check">Partager</Button>
        </div>
      </div>
    </div>
  );
};

// ============== CATEGORIES & RULES ==============================
const CategoriesScreen = ({ device }) => {
  const isMobile = device === "mobile";
  const [tab, setTab] = React.useState("cats");
  const ctx = React.useContext(window.AppContext);
  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {!isMobile && (
        <div className="between" style={{ marginBottom: 20 }}>
          <div>
            <div className="overline" style={{ marginBottom: 4 }}>Organisation</div>
            <div className="serif" style={{ fontSize: 32 }}>Catégories &amp; règles</div>
          </div>
          <Button variant="primary" icon="plus" size="sm" onClick={() => ctx.setModal("addCategory")}>{tab === "cats" ? "Nouvelle catégorie" : "Nouvelle règle"}</Button>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <Tabs items={[
          { id: "cats",  label: `Catégories (${CATEGORIES.length})` },
          { id: "rules", label: `Règles (${RULES.length})` },
        ]} active={tab} onChange={setTab} />
      </div>

      {tab === "cats" && (
        <Card padding={0}>
          {CATEGORIES.filter(c => !c.parentId).map(c => {
            const children = CATEGORIES.filter(x => x.parentId === c.id);
            return (
              <div key={c.id} style={{ borderTop: "1px solid var(--hairline)" }}>
                <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: c.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{c.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: "var(--ink)" }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{c.scope === "group" ? "Foyer Dupont" : "Personnel"} · {RULES.filter(r => r.categoryId === c.id).length} règle(s)</div>
                  </div>
                  <Pill tone="neutral">{children.length > 0 ? `${children.length} sous-cat.` : "—"}</Pill>
                  <button style={{ color: "var(--ink-3)", padding: 4 }}><Icon name="edit" size={14} /></button>
                </div>
                {children.length > 0 && (
                  <div style={{ paddingLeft: 60, paddingBottom: 8 }}>
                    {children.map(ch => (
                      <div key={ch.id} style={{ padding: "6px 20px 6px 0", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 8, background: ch.color }} />
                        <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{ch.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {tab === "rules" && (
        <Card padding={0}>
          <div style={{
            display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "auto 1fr auto auto auto auto",
            gap: 12, padding: "10px 20px", background: "var(--paper-2)",
            fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)",
          }}>
            <span>Prio.</span>
            <span>Motif</span>
            {!isMobile && <span>Type</span>}
            {!isMobile && <span>Cible</span>}
            {!isMobile && <span>Portée</span>}
            <span style={{ textAlign: "right" }}>Hits</span>
          </div>
          {RULES.map(r => {
            const cat = findCat(r.categoryId);
            return (
              <div key={r.id} style={{
                display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "auto 1fr auto auto auto auto",
                gap: 12, padding: "12px 20px", alignItems: "center",
                borderTop: "1px solid var(--hairline)",
              }}>
                {!isMobile && <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.priority}</span>}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.pattern}</div>
                  {isMobile && <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{labelMatch(r.matchType)} · {cat.name}</div>}
                </div>
                {!isMobile && <Pill tone="neutral">{labelMatch(r.matchType)}</Pill>}
                {!isMobile && <CategoryChip category={cat} size="sm" />}
                {!isMobile && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.scope === "group" ? "Foyer" : "Perso"}</span>}
                <span className="num" style={{ fontSize: 12.5, color: "var(--ink-2)", textAlign: "right" }}>{r.hits}</span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
};

const labelMatch = (m) => ({ CONTAINS: "Contient", REGEX: "Regex", EXACT: "Égal", STARTS_WITH: "Commence par" }[m]);

// ============== LINKS ============================================
const LinksScreen = ({ device }) => {
  const isMobile = device === "mobile";
  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {!isMobile && (
        <div className="between" style={{ marginBottom: 20 }}>
          <div>
            <div className="overline" style={{ marginBottom: 4 }}>Réconciliation</div>
            <div className="serif" style={{ fontSize: 32 }}>Liens de transactions</div>
            <div style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 4 }}>Lier les remboursements et virements internes pour ne pas les compter deux fois.</div>
          </div>
          <Button variant="secondary" icon="link" size="sm">Mode liaison</Button>
        </div>
      )}

      {/* Suggestions */}
      <SectionHeaderInline title="Suggestions" sub={`${LINK_SUGGESTIONS.length} paire(s) détectée(s)`} />
      {LINK_SUGGESTIONS.map(s => {
        const a = TRANSACTIONS.find(t => t.id === s.txA);
        const b = TRANSACTIONS.find(t => t.id === s.txB);
        return (
          <Card key={s.id} padding={18} style={{ marginBottom: 14 }}>
            <div className="between" style={{ marginBottom: 12 }}>
              <Pill tone="info" dot>Confiance {Math.round(s.confidence * 100)} %</Pill>
              <div style={{ display: "flex", gap: 6 }}>
                <Button variant="ghost" size="sm">Ignorer</Button>
                <Button variant="primary" size="sm" icon="link">Lier</Button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto 1fr", gap: 12, alignItems: "center" }}>
              <TxMiniCard tx={a} />
              {!isMobile && <span style={{ color: "var(--ink-3)" }}><Icon name="link" size={20} /></span>}
              <TxMiniCard tx={b} />
            </div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--ink-3)" }}>
              Écart : <span className="num">{s.gap}</span> · Total net <span className="num">0,00 €</span> → groupe équilibré
            </div>
          </Card>
        );
      })}

      <SectionHeaderInline title="Liens existants" sub={`${EXISTING_LINKS.length} groupe(s)`} />
      {EXISTING_LINKS.map(l => (
        <Card key={l.id} padding={18} style={{ marginBottom: 12 }}>
          <div className="between" style={{ marginBottom: 12 }}>
            <div className="row">
              <Icon name="link" size={16} />
              <div className="serif" style={{ fontSize: 18 }}>{l.name}</div>
              {l.balanced && <Pill tone="success" dot>Équilibré · exclu des totaux</Pill>}
            </div>
            <Button variant="ghost" size="sm">Dissocier</Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {l.members.map(m => <TxMiniCard key={m} tx={TRANSACTIONS.find(t => t.id === m)} />)}
          </div>
        </Card>
      ))}
    </div>
  );
};

const SectionHeaderInline = ({ title, sub }) => (
  <div className="between" style={{ marginTop: 18, marginBottom: 12, alignItems: "baseline" }}>
    <div className="serif" style={{ fontSize: 22 }}>{title}</div>
    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{sub}</span>
  </div>
);

const TxMiniCard = ({ tx }) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  return (
    <div style={{ padding: "10px 12px", background: "var(--paper-2)", borderRadius: 10, border: "1px solid var(--hairline)" }}>
      <div className="between">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: cat.color }} />
          <span style={{ fontSize: 13, color: "var(--ink)" }}>{tx.label}</span>
        </div>
        <span className="num" style={{ fontSize: 13.5, fontWeight: 500, color: tx.amount > 0 ? "var(--income)" : "var(--ink)" }}>
          {fmtEUR(tx.amount, { sign: tx.amount > 0 })}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>{fmtDate(tx.date)} · {acc?.name} · {cat.name}</div>
    </div>
  );
};

// ============== GROUPS ===========================================
const GroupsScreen = ({ device }) => {
  const isMobile = device === "mobile";
  const ctx = React.useContext(window.AppContext);
  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {!isMobile && (
        <div className="between" style={{ marginBottom: 20 }}>
          <div>
            <div className="overline" style={{ marginBottom: 4 }}>Partage</div>
            <div className="serif" style={{ fontSize: 32 }}>Foyer Dupont</div>
            <div style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 4 }}>2 membres · 2 comptes partagés · 1 budget commun</div>
          </div>
          <Button variant="primary" icon="plus" size="sm" onClick={() => ctx.setModal("inviteMember")}>Inviter un membre</Button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr", gap: 16 }}>
        <Card padding={0}>
          <div className="between" style={{ padding: "16px 20px" }}>
            <div className="serif" style={{ fontSize: 18 }}>Membres</div>
            <Pill tone="primary" soft>{HOUSEHOLD.members.length} actifs</Pill>
          </div>
          {HOUSEHOLD.members.map(m => (
            <div key={m.id} style={{ padding: "14px 20px", borderTop: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar initials={m.initials} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: "var(--ink)" }}>{m.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{m.id === "u_pierre" ? "pierre.dupont@example.fr" : "claire.dupont@example.fr"}</div>
              </div>
              <Pill tone={m.role === "OWNER" ? "primary" : "neutral"}>{m.role}</Pill>
              <button style={{ color: "var(--ink-3)" }}><Icon name="more" size={16} /></button>
            </div>
          ))}
          {HOUSEHOLD.pending.map((p, i) => (
            <div key={i} style={{ padding: "14px 20px", borderTop: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: 12, background: "var(--paper-2)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 36, border: "1px dashed var(--hairline-2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)" }}>
                <Icon name="mail" size={16} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{p.email}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Invitation envoyée {p.invitedAt}</div>
              </div>
              <Pill tone="warning" dot>En attente</Pill>
            </div>
          ))}
        </Card>

        <Card padding={20}>
          <div className="overline" style={{ marginBottom: 8 }}>Comptes partagés</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {ACCOUNTS.filter(a => a.sharedWith.length).map(a => (
              <div key={a.id} className="row" style={{ gap: 10 }}>
                <span style={{ width: 6, height: 24, borderRadius: 3, background: a.color }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--ink)" }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{a.permission === "WRITE" ? "Lecture + écriture" : "Lecture seule"}</div>
                </div>
                <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{fmtEURcompact(a.balance)}</span>
              </div>
            ))}
          </div>
          <div style={{ height: 1, background: "var(--hairline)", marginBottom: 14 }} />
          <div className="overline" style={{ marginBottom: 8 }}>Budgets communs</div>
          <div className="row" style={{ gap: 10, marginBottom: 4 }}>
            <span style={{ width: 6, height: 24, borderRadius: 3, background: "var(--cat-housing)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--ink)" }}>Foyer — mai</div>
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>1 369 € / 1 380 €</div>
            </div>
            <Pill tone="success" dot>OK</Pill>
          </div>
          <div style={{ marginTop: 16 }}>
            <Button variant="secondary" full icon="plus" onClick={() => ctx.setModal("inviteMember")}>Inviter un membre</Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

Object.assign(window, { BudgetsScreen, AccountsScreen, CategoriesScreen, LinksScreen, GroupsScreen });
