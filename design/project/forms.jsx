/* Add forms — modal dialogs for create flows */

const Modal = ({ title, subtitle, onClose, children, footer, width = 480 }) => (
  <div onClick={onClose} style={{
    position: "absolute", inset: 0, zIndex: 40,
    background: "rgba(20,17,13,.45)", backdropFilter: "blur(2px)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
  }}>
    <div onClick={(e) => e.stopPropagation()} style={{
      background: "var(--card)", border: "1px solid var(--hairline)",
      borderRadius: 16, width, maxWidth: "100%", maxHeight: "92%",
      boxShadow: "var(--shadow-3)", overflow: "hidden",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--hairline)", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="overline" style={{ marginBottom: 6 }}>Nouveau</div>
          <div className="serif" style={{ fontSize: 24, lineHeight: 1.1 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} style={{ color: "var(--ink-3)", padding: 4 }}><Icon name="x" size={16} /></button>
      </div>
      <div style={{ padding: 24, overflowY: "auto", flex: 1 }} className="scrollbar">
        {children}
      </div>
      {footer && (
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--hairline)", background: "var(--paper)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {footer}
        </div>
      )}
    </div>
  </div>
);

// --- Bottom sheet for mobile -------------------------------------
const Sheet = ({ title, subtitle, onClose, children, footer }) => (
  <div onClick={onClose} style={{
    position: "absolute", inset: 0, zIndex: 40,
    background: "rgba(20,17,13,.35)",
    display: "flex", alignItems: "flex-end",
  }}>
    <div onClick={(e) => e.stopPropagation()} style={{
      width: "100%", maxHeight: "92%",
      background: "var(--card)", borderRadius: "20px 20px 0 0",
      overflow: "hidden", display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "10px 0 0", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 36, height: 4, borderRadius: 4, background: "var(--hairline-2)" }} />
      </div>
      <div style={{ padding: "14px 20px 14px" }}>
        <div className="overline" style={{ marginBottom: 4 }}>Nouveau</div>
        <div className="serif" style={{ fontSize: 22, lineHeight: 1.1 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ padding: "0 20px 16px", overflowY: "auto", flex: 1 }} className="scrollbar">
        {children}
      </div>
      {footer && (
        <div style={{ padding: 16, borderTop: "1px solid var(--hairline)", background: "var(--paper)", display: "flex", flexDirection: "column", gap: 8 }}>
          {footer}
        </div>
      )}
    </div>
  </div>
);

// pick the right surface depending on device
const FormShell = (props) => {
  const isMobile = props.device === "mobile";
  return isMobile ? <Sheet {...props} /> : <Modal {...props} />;
};

// ================== ADD TRANSACTION ==============================
const AddTransactionForm = ({ device, onClose }) => {
  const [type, setType] = React.useState("out");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState("2026-05-26");
  const [accountId, setAccountId] = React.useState("a_courant");
  const [categoryId, setCategoryId] = React.useState("c_groceries");
  const [label, setLabel] = React.useState("");
  return (
    <FormShell
      device={device}
      title="Saisir une transaction"
      subtitle="Opération manuelle — sans import bancaire"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="check">Enregistrer</Button>
      </>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tabs items={[
          { id: "out", label: "Dépense" },
          { id: "in",  label: "Entrée" },
          { id: "tx",  label: "Virement interne" },
        ]} active={type} onChange={setType} />

        <Field label="Montant">
          <div style={{
            display: "flex", alignItems: "baseline", gap: 8,
            padding: "14px 16px", background: "var(--paper-2)",
            border: "1px solid var(--hairline)", borderRadius: 10,
          }}>
            <input
              type="text" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="num serif"
              style={{
                border: 0, outline: 0, background: "transparent",
                fontSize: 32, color: type === "in" ? "var(--income)" : "var(--ink)",
                fontFamily: "var(--font-display)", letterSpacing: "-.015em",
                width: "100%",
              }}
            />
            <span className="serif" style={{ fontSize: 22, color: "var(--ink-3)" }}>€</span>
          </div>
        </Field>

        <Field label="Libellé">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Carrefour Market…" />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Field label="Date">
            <Input value={date} onChange={(e) => setDate(e.target.value)} icon="list" />
          </Field>
          <Field label="Compte">
            <SelectButton>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: ACCOUNTS.find(a => a.id === accountId).color }} />
              {ACCOUNTS.find(a => a.id === accountId).name}
            </SelectButton>
          </Field>
        </div>

        <Field label="Catégorie">
          <CategoryPicker value={categoryId} onChange={setCategoryId} />
        </Field>

        <Field label="Note (privée)">
          <textarea
            placeholder="Optionnel — visible uniquement par vous"
            style={textareaStyle}
          />
        </Field>

        <CheckRow label="Affecter à un budget" off />
        <CheckRow label="Marquer comme exclu des moyennes" off />
      </div>
    </FormShell>
  );
};

// ================== ADD ACCOUNT ==================================
const AddAccountForm = ({ device, onClose }) => {
  const [type, setType] = React.useState("CHECKING");
  const [color, setColor] = React.useState("var(--cat-transport)");
  const palette = ["var(--cat-transport)", "var(--cat-housing)", "var(--cat-groceries)", "var(--cat-food)", "var(--cat-leisure)", "var(--cat-savings)", "var(--cat-shopping)", "var(--cat-bills)"];
  return (
    <FormShell
      device={device}
      title="Ajouter un compte"
      subtitle="Le compte devient visible dans les imports, les budgets et le partage."
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="check">Créer le compte</Button>
      </>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Type de compte">
          <Tabs items={[
            { id: "CHECKING", label: "Courant" },
            { id: "SAVINGS",  label: "Épargne" },
            { id: "CREDIT",   label: "Crédit" },
            { id: "OTHER",    label: "Autre" },
          ]} active={type} onChange={setType} />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Field label="Nom du compte"><Input placeholder="Compte courant" /></Field>
          <Field label="Banque"><Input placeholder="Crédit Coopératif" /></Field>
        </div>

        <Field label="Solde initial">
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "10px 12px", background: "var(--paper-2)", border: "1px solid var(--hairline)", borderRadius: 8 }}>
            <input type="text" placeholder="0,00" className="num" style={{ border: 0, outline: 0, background: "transparent", fontSize: 18, color: "var(--ink)", width: "100%" }} />
            <span style={{ fontSize: 14, color: "var(--ink-3)" }}>€</span>
          </div>
        </Field>

        <Field label="IBAN (optionnel, chiffré)">
          <Input placeholder="FR76 …" icon="lock" />
        </Field>

        <Field label="Couleur">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {palette.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 28, height: 28, borderRadius: 8, background: c,
                border: color === c ? "2px solid var(--ink)" : "2px solid transparent",
                cursor: "pointer",
              }} />
            ))}
          </div>
        </Field>

        <div style={{ padding: 12, background: "var(--info-bg)", borderRadius: 8, fontSize: 12.5, color: "var(--info)", display: "flex", gap: 8 }}>
          <Icon name="info" size={14} />
          <span>Ce compte sera privé par défaut. Vous pourrez le partager avec Foyer Dupont une fois créé.</span>
        </div>
      </div>
    </FormShell>
  );
};

// ================== ADD CATEGORY =================================
const AddCategoryForm = ({ device, onClose }) => {
  const [color, setColor] = React.useState("var(--cat-groceries)");
  const [scope, setScope] = React.useState("user");
  const palette = ["var(--cat-groceries)", "var(--cat-housing)", "var(--cat-transport)", "var(--cat-food)", "var(--cat-leisure)", "var(--cat-health)", "var(--cat-savings)", "var(--cat-shopping)", "var(--cat-bills)", "var(--cat-other)"];
  const icons = ["○", "▢", "→", "△", "◇", "+", "★", "□", "≡", "·"];
  const [icon, setIcon] = React.useState("○");
  return (
    <FormShell
      device={device}
      title="Nouvelle catégorie"
      subtitle="Vous pourrez attacher des règles de catégorisation après création."
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="check">Créer la catégorie</Button>
      </>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Preview */}
        <div style={{ padding: 18, background: "var(--paper-2)", border: "1px dashed var(--hairline-2)", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{icon}</span>
          <div>
            <div className="overline" style={{ marginBottom: 2 }}>Aperçu</div>
            <CategoryChip category={{ name: "Ma catégorie", color }} />
          </div>
        </div>

        <Field label="Nom"><Input placeholder="Cantine, Cadeaux, Vacances…" /></Field>

        <Field label="Catégorie parente">
          <SelectButton><span style={{ color: "var(--ink-3)" }}>Aucune (catégorie racine)</span></SelectButton>
        </Field>

        <Field label="Portée">
          <Tabs items={[
            { id: "user",  label: "Personnel" },
            { id: "group", label: "Foyer Dupont" },
          ]} active={scope} onChange={setScope} />
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>
            {scope === "group" ? "Visible par tous les membres du foyer." : "Visible uniquement par vous."}
          </div>
        </Field>

        <Field label="Couleur">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {palette.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 28, height: 28, borderRadius: 8, background: c,
                border: color === c ? "2px solid var(--ink)" : "2px solid transparent",
              }} />
            ))}
          </div>
        </Field>

        <Field label="Symbole">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {icons.map(g => (
              <button key={g} onClick={() => setIcon(g)} style={{
                width: 32, height: 32, borderRadius: 8,
                background: icon === g ? "var(--ink)" : "var(--paper-2)",
                color: icon === g ? "var(--paper)" : "var(--ink)",
                border: "1px solid var(--hairline)",
                fontSize: 14, fontWeight: 500,
              }}>{g}</button>
            ))}
          </div>
        </Field>
      </div>
    </FormShell>
  );
};

// ================== ADD BUDGET ===================================
const AddBudgetForm = ({ device, onClose }) => {
  const [period, setPeriod] = React.useState("MONTH");
  const [scope, setScope] = React.useState("user");
  const [lines, setLines] = React.useState([
    { id: 1, categoryId: "c_groceries", planned: 400 },
    { id: 2, categoryId: "c_food",      planned: 150 },
    { id: 3, categoryId: "c_transport", planned: 200 },
  ]);
  const addLine = () => setLines([...lines, { id: Date.now(), categoryId: "c_other", planned: 0 }]);
  const removeLine = (id) => setLines(lines.filter(l => l.id !== id));
  const total = lines.reduce((s, l) => s + Number(l.planned || 0), 0);
  return (
    <FormShell
      device={device}
      title="Nouveau budget"
      subtitle="Plan + plafonds par catégorie pour une période."
      width={560}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="check">Créer le budget</Button>
      </>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Nom"><Input placeholder="Juin 2026, Vacances été…" defaultValue="Juin 2026" /></Field>

        <div style={{ display: "grid", gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Field label="Portée">
            <Tabs items={[{ id: "user", label: "Personnel" }, { id: "group", label: "Foyer Dupont" }]} active={scope} onChange={setScope} />
          </Field>
          <Field label="Périodicité">
            <Tabs items={[
              { id: "MONTH",   label: "Mois" },
              { id: "QUARTER", label: "Trim." },
              { id: "YEAR",    label: "Année" },
              { id: "CUSTOM",  label: "Custom" },
            ]} active={period} onChange={setPeriod} />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: device === "mobile" ? "1fr 1fr" : "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Début"><Input defaultValue="01/06/2026" /></Field>
          <Field label="Fin"><Input defaultValue="30/06/2026" /></Field>
          {device !== "mobile" && (
            <Field label="Récurrence">
              <div style={{ display: "flex", alignItems: "center", gap: 10, height: 36 }}>
                <Switch checked={true} onChange={()=>{}} /><span style={{ fontSize: 13, color: "var(--ink-2)" }}>Mensuel</span>
              </div>
            </Field>
          )}
        </div>

        <div style={{ height: 1, background: "var(--hairline)" }} />

        <div className="between">
          <div className="overline">Lignes du budget</div>
          <div className="num" style={{ fontSize: 13, color: "var(--ink)" }}>{fmtEUR(total, { decimals: 0 })} planifié</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map(l => {
            const cat = findCat(l.categoryId);
            return (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1fr 130px auto", gap: 8, alignItems: "center" }}>
                <SelectButton>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: cat.color }} /> {cat.name}
                </SelectButton>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", height: 36, background: "var(--card)", border: "1px solid var(--hairline-2)", borderRadius: 8 }}>
                  <input
                    type="number"
                    defaultValue={l.planned}
                    className="num"
                    style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontSize: 13.5, color: "var(--ink)", width: "100%", textAlign: "right" }}
                  />
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>€</span>
                </div>
                <button onClick={() => removeLine(l.id)} style={{ color: "var(--ink-3)", padding: 8 }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
          <button onClick={addLine} style={{
            padding: "10px 12px", border: "1px dashed var(--hairline-2)",
            borderRadius: 8, color: "var(--ink-3)", fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}><Icon name="plus" size={14} /> Ajouter une ligne</button>
        </div>
      </div>
    </FormShell>
  );
};

// ================== INVITE MEMBER ================================
const InviteMemberForm = ({ device, onClose }) => {
  const [role, setRole] = React.useState("MEMBER");
  return (
    <FormShell
      device={device}
      title="Inviter un membre"
      subtitle="Un email est envoyé avec un lien valable 7 jours."
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="primary" icon="mail">Envoyer l'invitation</Button>
      </>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Email"><Input icon="mail" placeholder="thomas.martin@example.fr" /></Field>
        <Field label="Rôle dans le foyer">
          <Tabs items={[
            { id: "MEMBER", label: "Membre" },
            { id: "ADMIN",  label: "Administrateur" },
          ]} active={role} onChange={setRole} />
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>
            {role === "ADMIN"
              ? "Peut inviter / révoquer des membres et modifier les partages de compte."
              : "Peut consulter et modifier les transactions des comptes partagés."}
          </div>
        </Field>
        <Field label="Message (optionnel)">
          <textarea placeholder="Salut Thomas, j'ai ouvert un foyer Bilan pour partager nos comptes…" style={textareaStyle} />
        </Field>
      </div>
    </FormShell>
  );
};

// ================== HELPERS ======================================
const SelectButton = ({ children }) => (
  <button style={{
    height: 36, padding: "0 12px",
    background: "var(--card)", border: "1px solid var(--hairline-2)",
    borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
    fontSize: 13.5, color: "var(--ink)", width: "100%",
  }}>
    {children}
    <span style={{ flex: 1 }} />
    <Icon name="chevron-down" size={14} />
  </button>
);

const CategoryPicker = ({ value, onChange }) => {
  const top = CATEGORIES.filter(c => !c.parentId).slice(0, 8);
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {top.map(c => {
        const active = value === c.id;
        return (
          <button key={c.id} onClick={() => onChange(c.id)} style={{
            padding: "6px 10px 6px 8px", borderRadius: 999,
            display: "flex", alignItems: "center", gap: 6,
            background: active ? "var(--ink)" : "var(--paper-2)",
            color: active ? "var(--paper)" : "var(--ink)",
            border: "1px solid " + (active ? "var(--ink)" : "var(--hairline)"),
            fontSize: 12.5,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: c.color }} />
            {c.name}
          </button>
        );
      })}
    </div>
  );
};

const textareaStyle = {
  width: "100%", minHeight: 70, padding: "10px 12px",
  background: "var(--card)", border: "1px solid var(--hairline-2)",
  borderRadius: 8, fontSize: 13.5, fontFamily: "var(--font-sans)", color: "var(--ink)",
  resize: "vertical", outline: "none",
};

// ================== MOBILE DRAWER ================================
const MobileDrawer = ({ open, onClose, route, setRoute, theme, setTheme }) => {
  if (!open) return null;
  const all = [
    { id: "dashboard",    label: "Tableau de bord", icon: "home" },
    { id: "transactions", label: "Transactions",    icon: "list" },
    { id: "budgets",      label: "Budgets",         icon: "target" },
    { id: "accounts",     label: "Comptes",         icon: "wallet" },
    { id: "categories",   label: "Catégories",      icon: "tag" },
    { id: "links",        label: "Liens",           icon: "link" },
    { id: "groups",       label: "Foyer",           icon: "users" },
    { id: "import",       label: "Importer",        icon: "upload" },
  ];
  const adm = [
    { id: "settings",     label: "Préférences",     icon: "settings" },
    { id: "admin",        label: "Administration",  icon: "shield" },
  ];
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "rgba(20,17,13,.45)",
      display: "flex",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "82%", maxWidth: 320, height: "100%",
        background: "var(--paper)",
        display: "flex", flexDirection: "column",
        padding: "20px 14px",
      }}>
        {/* logo + close */}
        <div className="between" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BilanMark size={28} />
            <div className="serif" style={{ fontSize: 22, letterSpacing: "-.015em" }}>Bilan</div>
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 8, color: "var(--ink-3)" }}><Icon name="x" size={18} /></button>
        </div>

        {/* profile card */}
        <div style={{ padding: "12px 10px", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <Avatar initials="PD" size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>Pierre Dupont</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Foyer Dupont · SUPER_ADMIN</div>
          </div>
        </div>

        {/* Sections */}
        <div className="overline" style={{ padding: "0 10px 6px" }}>Espace</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {all.map(n => (
            <button key={n.id} onClick={() => { setRoute(n.id); onClose(); }} style={drawerItem(route === n.id)}>
              <Icon name={n.icon} size={16} /> {n.label}
            </button>
          ))}
        </div>

        <div className="overline" style={{ padding: "16px 10px 6px" }}>Compte</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {adm.map(n => (
            <button key={n.id} onClick={() => { setRoute(n.id); onClose(); }} style={drawerItem(route === n.id)}>
              <Icon name={n.icon} size={16} /> {n.label}
            </button>
          ))}
          <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} style={drawerItem(false)}>
            <Icon name={theme === "light" ? "moon" : "sun"} size={16} /> Thème&#8239;: {theme === "light" ? "clair" : "sombre"}
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <button style={{ ...drawerItem(false), color: "var(--expense)" }}>
          <Icon name="x" size={16} /> Se déconnecter
        </button>
      </div>
    </div>
  );
};

const drawerItem = (active) => ({
  padding: "10px 10px",
  display: "flex", alignItems: "center", gap: 10,
  borderRadius: 8,
  background: active ? "var(--card)" : "transparent",
  border: "1px solid " + (active ? "var(--hairline)" : "transparent"),
  color: active ? "var(--ink)" : "var(--ink-2)",
  fontWeight: active ? 500 : 400, fontSize: 13.5,
  textAlign: "left", width: "100%",
});

Object.assign(window, {
  Modal, Sheet, FormShell,
  AddTransactionForm, AddAccountForm, AddCategoryForm, AddBudgetForm, InviteMemberForm,
  MobileDrawer,
});
