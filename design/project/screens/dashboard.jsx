/* Dashboard — flagship screen */

const DashboardScreen = ({ device, monthIdx, layout = "editorial", budgetViz = "bar", scope }) => {
  const totals = monthTotals();
  const spending = spendingByCategory();
  const daily = dailySpend();
  const isMobile = device === "mobile";

  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {/* HEADER — editorial */}
      {!isMobile && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div className="overline" style={{ marginBottom: 8 }}>Vue d'ensemble · {scope === "household" ? "Foyer Dupont" : "Pierre Dupont"}</div>
            <div className="serif" style={{ fontSize: 44, lineHeight: 1, letterSpacing: "-.015em" }}>Mai 2026</div>
            <div style={{ color: "var(--ink-3)", marginTop: 8, fontSize: 13.5 }}>26 mai · semaine 21 · {TRANSACTIONS.filter(t => t.date.startsWith("2026-05")).length} transactions</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Pill tone="primary" soft dot>Mois en cours</Pill>
            <Pill tone="neutral">Clôture le 31 mai</Pill>
          </div>
        </div>
      )}

      {isMobile && (
        <div style={{ marginBottom: 16 }}>
          <div className="overline" style={{ marginBottom: 4 }}>Mai 2026 · solde net</div>
          <div className="serif num" style={{ fontSize: 40, lineHeight: 1, color: totals.net >= 0 ? "var(--income)" : "var(--expense)" }}>
            {fmtEUR(totals.net, { sign: true, decimals: 0 })}
          </div>
        </div>
      )}

      {/* KPI ROW */}
      <KPIRow totals={totals} isMobile={isMobile} />

      {/* MAIN GRID — editorial / cards / grid */}
      <div style={{
        marginTop: isMobile ? 20 : 28,
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : layout === "split" ? "1fr 1fr" : "1.4fr 1fr",
        gap: isMobile ? 16 : 20,
      }}>
        {/* Spending donut */}
        <Card padding={isMobile ? 18 : 24}>
          <div className="between" style={{ marginBottom: 16 }}>
            <div>
              <div className="overline">Répartition</div>
              <div className="serif" style={{ fontSize: 20, marginTop: 2 }}>Dépenses par catégorie</div>
            </div>
            <Tabs items={[{ id: "m", label: "Mois" }, { id: "q", label: "Trim." }, { id: "y", label: "Année" }]} active="m" onChange={()=>{}} />
          </div>
          <div style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: "center", gap: isMobile ? 16 : 24,
          }}>
            <Donut
              size={isMobile ? 180 : 220}
              thickness={isMobile ? 22 : 26}
              data={spending.map(s => ({ value: s.amount, color: s.category.color }))}
              centerLabel={fmtEURcompact(totals.expense)}
              centerSub="dépensés ce mois"
            />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              {spending.slice(0, 6).map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 10, background: s.category.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, color: "var(--ink)" }}>{s.category.name}</span>
                  <span className="num" style={{ fontSize: 13, color: "var(--ink-2)" }}>{fmtEURcompact(s.amount)}</span>
                  <span className="num" style={{ width: 38, textAlign: "right", fontSize: 11.5, color: "var(--ink-3)" }}>{Math.round((s.amount / totals.expense) * 100)} %</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Daily trace */}
        <Card padding={isMobile ? 18 : 24}>
          <div className="between" style={{ marginBottom: 16 }}>
            <div>
              <div className="overline">Quotidien</div>
              <div className="serif" style={{ fontSize: 20, marginTop: 2 }}>Dépenses jour par jour</div>
            </div>
            <Pill tone="warning" dot>Pic le 21</Pill>
          </div>
          <div style={{ marginBottom: 8 }}>
            <MiniBars points={daily.slice(0, 26)} width={isMobile ? 320 : 380} height={isMobile ? 80 : 100} color="var(--ink-2)" highlightLast />
          </div>
          <div className="between" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
            <span>1 mai</span><span>10</span><span>20</span><span>aujourd'hui</span>
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Stat label="Moy. / jour" value={fmtEURcompact(totals.expense / 26)} />
              <Stat label="Plus gros jour" value={fmtEURcompact(1240)} sub="21 mai · Loyer" />
            </div>
          </div>
        </Card>
      </div>

      {/* SECOND ROW */}
      <div style={{
        marginTop: isMobile ? 16 : 20,
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1.2fr",
        gap: isMobile ? 16 : 20,
      }}>
        {/* Budgets snapshot */}
        <BudgetSnapshot viz={budgetViz} isMobile={isMobile} />

        {/* Recent transactions */}
        <RecentTransactions isMobile={isMobile} />
      </div>

      {/* THIRD ROW */}
      {!isMobile && (
        <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
          <AccountsStrip />
          <UpcomingStrip />
          <HouseholdStrip />
        </div>
      )}

      {isMobile && (
        <>
          <div style={{ marginTop: 16 }}><AccountsStrip /></div>
          <div style={{ marginTop: 16 }}><UpcomingStrip /></div>
        </>
      )}
    </div>
  );
};

// ---------- KPI row ------------------------------------------------
const KPIRow = ({ totals, isMobile }) => (
  <div style={{
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
    gap: isMobile ? 10 : 14,
  }}>
    <KPI label="Revenus" value={fmtEURcompact(totals.income)} sub="↗ +2,1 % vs avril" tone="success" big={!isMobile} />
    <KPI label="Dépenses" value={fmtEURcompact(totals.expense)} sub="↗ +8,4 % vs avril" tone="danger" big={!isMobile} />
    <KPI label="Épargne" value={fmtEURcompact(totals.saved)} sub="Virement automatique" tone="primary" big={!isMobile} />
    <KPI label="Solde net" value={fmtEUR(totals.net, { sign: true, decimals: 0 })} sub="Disponible fin de mois" tone={totals.net >= 0 ? "success" : "danger"} big={!isMobile} />
  </div>
);

const KPI = ({ label, value, sub, tone, big }) => {
  const color = { success: "var(--income)", danger: "var(--expense)", primary: "var(--primary)" }[tone] || "var(--ink)";
  return (
    <Card padding={big ? 20 : 14} style={{ display: "flex", flexDirection: "column", gap: big ? 8 : 4 }}>
      <div className="overline">{label}</div>
      <div className="num serif" style={{ fontSize: big ? 30 : 22, lineHeight: 1, color, letterSpacing: "-.01em" }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{sub}</div>
    </Card>
  );
};

const Stat = ({ label, value, sub }) => (
  <div>
    <div className="overline" style={{ marginBottom: 2 }}>{label}</div>
    <div className="num" style={{ fontSize: 18, color: "var(--ink)", fontWeight: 500 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{sub}</div>}
  </div>
);

// ---------- Budget snapshot ---------------------------------------
const BudgetSnapshot = ({ viz, isMobile }) => {
  const b = BUDGETS[0];
  const lines = b.lines;
  return (
    <Card padding={isMobile ? 18 : 24}>
      <div className="between" style={{ marginBottom: 16 }}>
        <div>
          <div className="overline">Mai 2026</div>
          <div className="serif" style={{ fontSize: 20, marginTop: 2 }}>Mon budget</div>
        </div>
        <Button variant="ghost" size="sm" iconRight="chevron-right">Détail</Button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {lines.slice(0, 5).map(l => {
          const cat = findCat(l.categoryId);
          const ratio = l.spent / l.planned;
          const over = ratio > 1;
          return (
            <div key={l.id}>
              <div className="between" style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: cat.color }} />
                  <span style={{ fontSize: 13, color: "var(--ink)" }}>{cat.name}</span>
                  {over && <Pill tone="danger" soft={false} style={{ height: 18, fontSize: 10.5 }}>Dépassé</Pill>}
                </div>
                <div className="num" style={{ fontSize: 12.5, color: over ? "var(--expense)" : "var(--ink-2)" }}>
                  {fmtEURcompact(l.spent)} <span style={{ color: "var(--ink-3)" }}>/ {fmtEURcompact(l.planned)}</span>
                </div>
              </div>
              {viz === "bar"  && <BudgetBar spent={l.spent} planned={l.planned} />}
              {viz === "gauge" && <BudgetGauge spent={l.spent} planned={l.planned} color={cat.color} />}
              {viz === "ring"  && <BudgetRingLine spent={l.spent} planned={l.planned} color={cat.color} />}
              {viz === "spark" && <BudgetSpark spent={l.spent} planned={l.planned} color={cat.color} />}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

const BudgetGauge = ({ spent, planned, color }) => {
  const ratio = Math.min(1.3, spent / planned);
  return (
    <div style={{ display: "flex", height: 18, gap: 2 }}>
      {Array.from({ length: 14 }).map((_, i) => {
        const filled = i / 14 < Math.min(1, ratio);
        const over = i / 14 < ratio && i / 14 >= 1;
        return <div key={i} style={{ flex: 1, background: over ? "var(--expense)" : filled ? color : "var(--paper-2)", borderRadius: 2 }} />;
      })}
    </div>
  );
};

const BudgetRingLine = ({ spent, planned, color }) => {
  const ratio = Math.min(1, spent / planned);
  const C = 2 * Math.PI * 9;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" stroke="var(--paper-2)" strokeWidth="3" fill="none" />
        <circle cx="12" cy="12" r="9" stroke={spent > planned ? "var(--expense)" : color} strokeWidth="3" fill="none"
                strokeDasharray={`${ratio * C} ${C}`} strokeLinecap="round" transform="rotate(-90 12 12)" />
      </svg>
      <div className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{Math.round((spent / planned) * 100)} %</div>
      <div style={{ flex: 1 }} />
    </div>
  );
};

const BudgetSpark = ({ spent, planned, color }) => {
  const days = [12, 8, 14, 6, 22, 18, 30, 15, 25, 20].slice(0, 10);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1 }}>
        <Sparkline points={days} width={200} height={28} color={spent > planned ? "var(--expense)" : color} fill="transparent" />
      </div>
      <div className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{Math.round((spent / planned) * 100)} %</div>
    </div>
  );
};

// ---------- Recent transactions -----------------------------------
const RecentTransactions = ({ isMobile }) => {
  const txs = TRANSACTIONS.slice(0, isMobile ? 6 : 8);
  return (
    <Card padding={isMobile ? 0 : 0}>
      <div className="between" style={{ padding: isMobile ? "16px 18px 8px" : "20px 24px 8px" }}>
        <div>
          <div className="overline">Récent</div>
          <div className="serif" style={{ fontSize: 20, marginTop: 2 }}>Dernières opérations</div>
        </div>
        <Button variant="ghost" size="sm" iconRight="chevron-right">Tout voir</Button>
      </div>
      <div>
        {txs.map(t => (
          <TxRow key={t.id} tx={t} compact={isMobile} />
        ))}
      </div>
    </Card>
  );
};

const TxRow = ({ tx, compact }) => {
  const cat = findCat(tx.categoryId);
  const acc = ACCOUNTS.find(a => a.id === tx.accountId);
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: compact ? "1fr auto" : "auto 1fr auto auto",
      gap: 12, alignItems: "center",
      padding: compact ? "10px 18px" : "10px 24px",
      borderTop: "1px solid var(--hairline)",
    }}>
      {!compact && (
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: cat.color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 500, opacity: 0.92,
        }}>{cat.icon}</div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.label}</span>
          {tx.linked && <span title="Liée" style={{ color: "var(--ink-3)", display: "flex" }}><Icon name="link" size={12} /></span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{fmtDate(tx.date)}</span>
          <span style={{ width: 3, height: 3, borderRadius: 3, background: "var(--ink-4)" }} />
          {!compact && <CategoryChip category={cat} size="sm" />}
          {compact && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{cat.name}</span>}
        </div>
      </div>
      {!compact && (
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{acc?.name}</span>
      )}
      <span className="num" style={{
        fontSize: compact ? 14 : 14.5, fontWeight: 500,
        color: tx.amount > 0 ? "var(--income)" : "var(--ink)",
        letterSpacing: "-.01em",
      }}>
        {fmtEUR(tx.amount, { sign: tx.amount > 0 })}
      </span>
    </div>
  );
};

// ---------- Accounts strip ----------------------------------------
const AccountsStrip = () => (
  <Card padding={20}>
    <div className="between" style={{ marginBottom: 12 }}>
      <div className="overline">Comptes</div>
      <Button variant="ghost" size="sm" iconRight="chevron-right">Gérer</Button>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ACCOUNTS.slice(0, 4).map(a => (
        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 6, height: 28, borderRadius: 3, background: a.color }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--ink)" }}>{a.name}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{a.bank}</div>
          </div>
          <div className="num" style={{ fontSize: 14, color: a.balance < 0 ? "var(--expense)" : "var(--ink)", fontWeight: 500 }}>
            {fmtEURcompact(a.balance)}
          </div>
        </div>
      ))}
    </div>
  </Card>
);

// ---------- Upcoming strip ----------------------------------------
const UpcomingStrip = () => {
  const items = [
    { label: "Loyer juin", due: "1 juin", amount: -1240, cat: "c_rent" },
    { label: "EDF", due: "5 juin", amount: -129, cat: "c_energy" },
    { label: "Salaire", due: "15 juin", amount: 2980, cat: "c_salary" },
    { label: "Netflix", due: "24 juin", amount: -18.90, cat: "c_bills" },
  ];
  return (
    <Card padding={20}>
      <div className="between" style={{ marginBottom: 12 }}>
        <div className="overline">À venir</div>
        <Pill tone="info" soft>4 prélèvements</Pill>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it, i) => {
          const cat = findCat(it.cat);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 6, height: 28, borderRadius: 3, background: cat.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--ink)" }}>{it.label}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{it.due}</div>
              </div>
              <div className="num" style={{ fontSize: 13.5, color: it.amount > 0 ? "var(--income)" : "var(--ink-2)", fontWeight: 500 }}>
                {fmtEUR(it.amount, { sign: it.amount > 0, decimals: 0 })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

// ---------- Household strip ---------------------------------------
const HouseholdStrip = () => (
  <Card padding={20}>
    <div className="between" style={{ marginBottom: 12 }}>
      <div className="overline">Foyer Dupont</div>
      <Button variant="ghost" size="sm" iconRight="chevron-right">Foyer</Button>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div className="num serif" style={{ fontSize: 22, color: "var(--ink)" }}>
          {fmtEUR(1369, { decimals: 0 })}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>dépenses partagées ce mois</div>
      </div>
      <BudgetBar spent={1369} planned={1380} height={6} />
      <div style={{ display: "flex", gap: -6, marginTop: 8 }}>
        {HOUSEHOLD.members.map((m, i) => (
          <div key={m.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
            <Avatar initials={m.initials} size={26} />
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon="plus">Inviter</Button>
      </div>
    </div>
  </Card>
);

Object.assign(window, { DashboardScreen });
