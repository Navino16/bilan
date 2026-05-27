/* Import CSV + Auth + Settings + Admin screens */

// ============== IMPORT CSV =======================================
const ImportScreen = ({ device }) => {
  const isMobile = device === "mobile";
  const [step, setStep] = React.useState(2); // 0=upload 1=parsing 2=mapping 3=commit 4=done
  const [account, setAccount] = React.useState("a_courant");

  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {!isMobile && (
        <div className="between" style={{ marginBottom: 20 }}>
          <div>
            <div className="overline" style={{ marginBottom: 4 }}>Import</div>
            <div className="serif" style={{ fontSize: 32 }}>Importer un relevé</div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>CSV · PDF · Saisie manuelle</div>
        </div>
      )}

      {/* Stepper */}
      <div style={{ display: "flex", gap: 0, marginBottom: 18, padding: "12px 14px", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 12, overflowX: "auto" }} className="scrollbar">
        {["Fichier", "Lecture", "Correspondances", "Validation"].map((s, i) => (
          <React.Fragment key={s}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: step >= i ? 1 : 0.45 }}>
              <span style={{
                width: 22, height: 22, borderRadius: 22,
                background: step > i ? "var(--primary)" : step === i ? "var(--ink)" : "var(--paper-2)",
                color: step >= i ? "var(--paper)" : "var(--ink-3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-mono)",
              }}>{step > i ? "✓" : i + 1}</span>
              <span style={{ fontSize: 13, color: step === i ? "var(--ink)" : "var(--ink-3)", fontWeight: step === i ? 500 : 400, whiteSpace: "nowrap" }}>{s}</span>
            </div>
            {i < 3 && <div style={{ flex: 1, minWidth: 30, height: 1, background: "var(--hairline)", margin: "0 12px" }} />}
          </React.Fragment>
        ))}
      </div>

      {/* PREVIEW + MAPPING (step 2) */}
      {step === 2 && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "320px 1fr", gap: 16 }}>
          {/* Side controls */}
          <Card padding={20}>
            <div className="overline" style={{ marginBottom: 8 }}>Fichier</div>
            <div style={{ padding: 10, background: "var(--paper-2)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--ink)", color: "var(--paper)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 10 }}>CSV</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>releve-mai-2026.csv</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>28 lignes · 4,2 Ko</div>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="overline" style={{ marginBottom: 8 }}>Compte de destination</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ACCOUNTS.map(a => (
                  <button key={a.id} onClick={() => setAccount(a.id)} style={{
                    padding: "10px 12px", borderRadius: 8,
                    background: account === a.id ? "var(--primary-soft)" : "var(--card-2)",
                    border: "1px solid " + (account === a.id ? "var(--primary)" : "var(--hairline)"),
                    display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: a.color }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--ink)" }}>{a.name}</div>
                      <div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{a.bank}</div>
                    </div>
                    {account === a.id && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="overline" style={{ marginBottom: 8 }}>Correspondance des colonnes</div>
              <FieldMap label="Date" value="Date opération" />
              <FieldMap label="Libellé" value="Libellé" />
              <FieldMap label="Montant" value="Montant" />
              <FieldMap label="Type" value="auto-détecté" />
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="overline" style={{ marginBottom: 8 }}>Options</div>
              <CheckRow label="Détecter les doublons" />
              <CheckRow label="Catégoriser automatiquement" />
              <CheckRow label="Suggérer des liens" off />
            </div>
          </Card>

          {/* Preview table */}
          <Card padding={0}>
            <div className="between" style={{ padding: "16px 20px" }}>
              <div>
                <div className="serif" style={{ fontSize: 18 }}>Aperçu — 28 transactions</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>3 doublons potentiels · 26 catégorisées automatiquement</div>
              </div>
              <Button variant="primary" size="sm" iconRight="chevron-right">Valider l'import</Button>
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "70px 1fr 1fr 130px 110px",
              gap: 12, padding: "10px 20px", background: "var(--paper-2)",
              fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)",
              borderTop: "1px solid var(--hairline)", borderBottom: "1px solid var(--hairline)",
            }}>
              <span>Date</span><span>Libellé brut</span><span>Catégorie suggérée</span><span>Type</span><span style={{ textAlign: "right" }}>Montant</span>
            </div>
            {TRANSACTIONS.slice(0, 10).map((t, i) => {
              const cat = findCat(t.categoryId);
              const dup = i === 6;
              return (
                <div key={t.id} style={{
                  display: "grid", gridTemplateColumns: "70px 1fr 1fr 130px 110px",
                  gap: 12, padding: "10px 20px", alignItems: "center",
                  borderTop: "1px solid var(--hairline)",
                  background: dup ? "var(--warning-bg)" : "transparent",
                }}>
                  <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{fmtDate(t.date)}</span>
                  <span style={{ fontSize: 12.5, fontFamily: "var(--font-mono)", color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.rawLabel}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CategoryChip category={cat} size="sm" />
                    {dup && <Pill tone="warning" dot>doublon</Pill>}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{labelType(t.type)}</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 500, color: t.amount > 0 ? "var(--income)" : "var(--ink)", textAlign: "right" }}>
                    {fmtEUR(t.amount, { sign: t.amount > 0 })}
                  </span>
                </div>
              );
            })}
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--hairline)", textAlign: "center", color: "var(--ink-3)", fontSize: 12 }}>
              + 18 lignes supplémentaires
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

const FieldMap = ({ label, value }) => (
  <div style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--hairline)" }}>
    <span style={{ width: 70, fontSize: 12, color: "var(--ink-3)" }}>{label}</span>
    <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink)" }}>{value}</span>
    <Icon name="check" size={13} />
  </div>
);

const CheckRow = ({ label, off }) => (
  <div style={{ display: "flex", alignItems: "center", padding: "6px 0", gap: 10 }}>
    <span style={{
      width: 16, height: 16, borderRadius: 4,
      background: off ? "transparent" : "var(--primary)",
      border: "1px solid " + (off ? "var(--hairline-2)" : "var(--primary)"),
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff",
    }}>{!off && <Icon name="check" size={11} stroke={3} />}</span>
    <span style={{ fontSize: 12.5, color: off ? "var(--ink-3)" : "var(--ink)" }}>{label}</span>
  </div>
);

// ============== AUTH =============================================
const AuthScreen = ({ device }) => {
  const isMobile = device === "mobile";
  const [mode, setMode] = React.useState("login"); // login | signup | setup | 2fa | reset
  return (
    <div style={{
      minHeight: "100%", display: "flex",
      background: mode === "setup" ? "var(--paper)" : "var(--paper)",
    }}>
      {!isMobile && mode !== "setup" && (
        <div style={{
          flex: 1, padding: 48, background: "var(--ink)", color: "var(--paper)",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BilanMark size={32} />
            <div className="serif" style={{ fontSize: 26, color: "var(--paper)" }}>Bilan</div>
          </div>
          <div style={{ position: "relative", zIndex: 1 }}>
            <div className="serif" style={{ fontSize: 56, lineHeight: 1.05, letterSpacing: "-.015em", maxWidth: 520 }}>
              Comprendre où passe l'argent, sans céder son intimité.
            </div>
            <div style={{ marginTop: 20, fontSize: 14, color: "rgba(243,239,230,.55)", maxWidth: 480, lineHeight: 1.5 }}>
              Bilan chiffre vos relevés sur votre serveur. Multi-comptes, partage à la maille, catégorisation apprise.
            </div>
            <div style={{ marginTop: 32, display: "flex", gap: 14, fontSize: 12, color: "rgba(243,239,230,.45)", flexWrap: "wrap" }}>
              <span>AES-256-GCM</span>
              <span>·</span>
              <span>Argon2id</span>
              <span>·</span>
              <span>2FA &amp; passkeys</span>
              <span>·</span>
              <span>OIDC</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "rgba(243,239,230,.4)" }}>v0.9.0 · self-hosted</div>
        </div>
      )}

      <div style={{ flex: isMobile ? 1 : 0, width: isMobile ? "100%" : 480, padding: isMobile ? 24 : 48, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <BilanMark size={28} />
            <div className="serif" style={{ fontSize: 22 }}>Bilan</div>
          </div>
        )}

        {/* Mini switcher for the prototype */}
        <div style={{ marginBottom: 24 }}>
          <Tabs items={[
            { id: "login",  label: "Connexion" },
            { id: "signup", label: "Inscription" },
            { id: "setup",  label: "1er lancement" },
          ]} active={mode} onChange={setMode} />
        </div>

        {mode === "login"  && <LoginForm />}
        {mode === "signup" && <SignupForm />}
        {mode === "setup"  && <SetupWizard />}
      </div>
    </div>
  );
};

const LoginForm = () => (
  <div>
    <div className="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>Bon retour.</div>
    <div style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 4, marginBottom: 24 }}>
      Connectez-vous à votre instance Bilan.
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Email"><Input icon="mail" placeholder="pierre.dupont@example.fr" defaultValue="pierre.dupont@example.fr" /></Field>
      <Field label="Mot de passe"><Input icon="lock" type="password" placeholder="••••••••••" defaultValue="••••••••••" /></Field>
      <div className="between" style={{ marginTop: 2 }}>
        <div className="row" style={{ gap: 8 }}>
          <CheckRow label="Se souvenir de moi" />
        </div>
        <a style={{ fontSize: 12.5, color: "var(--primary)" }}>Mot de passe oublié&#8239;?</a>
      </div>
      <Button variant="primary" full size="lg">Se connecter</Button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0", color: "var(--ink-3)", fontSize: 11.5 }}>
        <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
        ou continuer avec
        <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
      </div>
      <Button variant="secondary" full icon="key">Authentik (Foyer Dupont)</Button>
      <Button variant="secondary" full icon="external">Passkey</Button>
    </div>
    <div style={{ marginTop: 24, fontSize: 12.5, color: "var(--ink-3)", textAlign: "center" }}>
      Premier accès&#8239;? <a style={{ color: "var(--primary)" }}>Demander une invitation</a>
    </div>
  </div>
);

const SignupForm = () => (
  <div>
    <div className="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>Créer un compte.</div>
    <div style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 4, marginBottom: 24 }}>
      Invité&nbsp;: <strong style={{ color: "var(--ink)" }}>Foyer Dupont</strong> · Pierre Dupont
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Nom complet"><Input placeholder="Claire Dupont" /></Field>
      <Field label="Email"><Input icon="mail" placeholder="claire.dupont@example.fr" /></Field>
      <Field label="Mot de passe">
        <Input icon="lock" type="password" placeholder="Au moins 12 caractères" />
      </Field>
      <PasswordStrength score={3} />
      <Field label="Langue">
        <Tabs items={[{ id: "fr", label: "Français" }, { id: "en", label: "English" }]} active="fr" onChange={()=>{}} />
      </Field>
      <Button variant="primary" full size="lg">Créer mon compte</Button>
    </div>
    <div style={{ marginTop: 16, fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
      En continuant, vous acceptez les conditions d'utilisation de cette instance Bilan. Aucune donnée n'est transmise à un tiers.
    </div>
  </div>
);

const PasswordStrength = ({ score = 2 }) => {
  const labels = ["Faible", "Moyen", "Bon", "Excellent"];
  const colors = ["var(--expense)", "var(--warning)", "var(--primary)", "var(--income)"];
  return (
    <div>
      <div style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= score ? colors[score] : "var(--paper-2)" }} />
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: colors[score], marginTop: 6 }}>Force du mot de passe&#8239;: {labels[score]}</div>
    </div>
  );
};

const SetupWizard = () => (
  <div>
    <div className="overline" style={{ marginBottom: 8 }}>Premier lancement · Étape 1 sur 4</div>
    <div className="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>Bienvenue dans Bilan.</div>
    <div style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 4, marginBottom: 24 }}>
      Créez le premier compte administrateur. Cet utilisateur aura le rôle SUPER_ADMIN.
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Nom"><Input placeholder="Pierre Dupont" /></Field>
      <Field label="Email"><Input icon="mail" placeholder="pierre@dupont.fr" /></Field>
      <Field label="Mot de passe"><Input icon="lock" type="password" placeholder="Au moins 12 caractères" /></Field>
      <div style={{ padding: 12, background: "var(--info-bg)", borderRadius: 8, fontSize: 12, color: "var(--info)", display: "flex", gap: 8 }}>
        <Icon name="info" size={14} />
        <span>Aux prochaines étapes&#8239;: SMTP, fournisseur OIDC, mode d'inscription (par défaut <strong>invitation uniquement</strong>).</span>
      </div>
      <Button variant="primary" full size="lg" iconRight="chevron-right">Continuer</Button>
    </div>
  </div>
);

// ============== SETTINGS ==========================================
const SettingsScreen = ({ device }) => {
  const isMobile = device === "mobile";
  const [tab, setTab] = React.useState("profile");
  const { theme, setTheme } = React.useContext(window.AppContext);
  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {!isMobile && (
        <div style={{ marginBottom: 20 }}>
          <div className="overline" style={{ marginBottom: 4 }}>Mon compte</div>
          <div className="serif" style={{ fontSize: 32 }}>Préférences</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "200px 1fr", gap: 20 }}>
        {/* Side */}
        <div style={{ display: "flex", flexDirection: isMobile ? "row" : "column", gap: 4, overflowX: "auto" }} className="scrollbar">
          {[
            { id: "profile",  label: "Profil",       icon: "settings" },
            { id: "security", label: "Sécurité",     icon: "shield" },
            { id: "sessions", label: "Sessions",     icon: "key" },
            { id: "data",     label: "Mes données",  icon: "download" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 12px", borderRadius: 7,
              display: "flex", alignItems: "center", gap: 8,
              background: tab === t.id ? "var(--card)" : "transparent",
              border: "1px solid " + (tab === t.id ? "var(--hairline)" : "transparent"),
              color: tab === t.id ? "var(--ink)" : "var(--ink-3)",
              fontSize: 13, fontWeight: tab === t.id ? 500 : 400, whiteSpace: "nowrap", textAlign: "left",
            }}><Icon name={t.icon} size={14} /> {t.label}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {tab === "profile" && (
            <>
              <Card padding={20}>
                <div className="overline" style={{ marginBottom: 12 }}>Identité</div>
                <div className="row" style={{ marginBottom: 16, gap: 14 }}>
                  <Avatar initials="PD" size={56} />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: "var(--ink)" }}>Pierre Dupont</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>pierre.dupont@example.fr · SUPER_ADMIN</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                  <Field label="Nom"><Input defaultValue="Pierre Dupont" /></Field>
                  <Field label="Email"><Input icon="mail" defaultValue="pierre.dupont@example.fr" /></Field>
                </div>
              </Card>

              <Card padding={20}>
                <div className="overline" style={{ marginBottom: 12 }}>Préférences</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <SettingRow title="Langue" sub="Affichage des libellés, dates et nombres">
                    <Tabs items={[{ id: "fr", label: "Français" }, { id: "en", label: "English" }]} active="fr" onChange={()=>{}} />
                  </SettingRow>
                  <SettingRow title="Thème" sub={theme === "light" ? "Clair — fond papier" : "Sombre — fond encre"}>
                    <Tabs items={[{ id: "light", label: "Clair" }, { id: "dark", label: "Sombre" }]} active={theme} onChange={setTheme} />
                  </SettingRow>
                  <SettingRow title="Compte par défaut" sub="Pré-sélectionné à l'import et lors de la saisie">
                    <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Compte courant</span>
                  </SettingRow>
                  <SettingRow title="Fenêtre de liaison" sub="Écart maximal entre deux transactions pour suggérer un lien">
                    <span className="num" style={{ fontSize: 13, color: "var(--ink-2)" }}>30 jours</span>
                  </SettingRow>
                </div>
              </Card>
            </>
          )}

          {tab === "security" && (
            <>
              <Card padding={20}>
                <div className="overline" style={{ marginBottom: 12 }}>Mot de passe</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <Field label="Actuel"><Input icon="lock" type="password" /></Field>
                  <Field label="Nouveau"><Input icon="lock" type="password" /></Field>
                  <Field label="Confirmation"><Input icon="lock" type="password" /></Field>
                </div>
                <Button variant="primary" size="sm">Changer le mot de passe</Button>
              </Card>

              <Card padding={20}>
                <div className="overline" style={{ marginBottom: 12 }}>Authentification à deux facteurs</div>
                <SettingRow title="Application authentificator" sub="Activé · 8 codes de secours">
                  <Pill tone="success" dot>Actif</Pill>
                </SettingRow>
                <div style={{ height: 1, background: "var(--hairline)", margin: "12px 0" }} />
                <SettingRow title="Clé d'accès (passkey)" sub="MacBook Pro · enregistrée le 12 mai 2026">
                  <Pill tone="success" dot>Active</Pill>
                </SettingRow>
                <div style={{ marginTop: 14 }}>
                  <Button variant="secondary" size="sm" icon="plus">Ajouter une clé d'accès</Button>
                </div>
              </Card>
            </>
          )}

          {tab === "sessions" && (
            <Card padding={0}>
              <div style={{ padding: "16px 20px" }}>
                <div className="overline" style={{ marginBottom: 4 }}>Sessions actives</div>
                <div className="serif" style={{ fontSize: 18 }}>{SESSIONS.length} sessions ouvertes</div>
              </div>
              {SESSIONS.map(s => (
                <div key={s.id} style={{ padding: "14px 20px", borderTop: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--paper-2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)" }}>
                    <Icon name="key" size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, color: "var(--ink)" }}>{s.device}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{s.ip} · {s.last}</div>
                  </div>
                  {s.current ? <Pill tone="primary" dot>Cette session</Pill> : <Button variant="ghost" size="sm">Révoquer</Button>}
                </div>
              ))}
              <div style={{ padding: 14, borderTop: "1px solid var(--hairline)", textAlign: "right" }}>
                <Button variant="danger" size="sm">Révoquer toutes les autres</Button>
              </div>
            </Card>
          )}

          {tab === "data" && (
            <>
              <Card padding={20}>
                <div className="overline" style={{ marginBottom: 8 }}>Export de mes données</div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 14, lineHeight: 1.5 }}>
                  Téléchargez l'ensemble de vos comptes, transactions, catégories, règles, budgets et liens au format JSON.
                </div>
                <Button variant="secondary" size="sm" icon="download">Télécharger l'export (JSON)</Button>
              </Card>
              <Card padding={20} style={{ borderColor: "var(--expense-bg)" }}>
                <div className="overline" style={{ marginBottom: 8, color: "var(--expense)" }}>Zone à risque</div>
                <div style={{ fontSize: 14, color: "var(--ink)", marginBottom: 4 }}>Supprimer mon compte</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 14, lineHeight: 1.5 }}>
                  Suppression irréversible. Toutes vos transactions, catégories personnelles et budgets seront définitivement effacés.
                </div>
                <Button variant="danger" size="sm" icon="trash">Supprimer mon compte</Button>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const SettingRow = ({ title, sub, children }) => (
  <div className="between" style={{ alignItems: "flex-start", gap: 12 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13.5, color: "var(--ink)" }}>{title}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>}
    </div>
    {children}
  </div>
);

// ============== ADMIN =============================================
const AdminScreen = ({ device }) => {
  const isMobile = device === "mobile";
  const [tab, setTab] = React.useState("providers");
  return (
    <div style={{ padding: isMobile ? 16 : 32, paddingBottom: isMobile ? 96 : 32 }}>
      {!isMobile && (
        <div className="between" style={{ marginBottom: 20 }}>
          <div className="row" style={{ gap: 12 }}>
            <Icon name="shield" size={22} />
            <div>
              <div className="overline" style={{ marginBottom: 4 }}>Admin · SUPER_ADMIN</div>
              <div className="serif" style={{ fontSize: 32 }}>Administration</div>
            </div>
          </div>
          <Pill tone="warning" dot>Mode invitation uniquement</Pill>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <Tabs items={[
          { id: "providers", label: "Authentification" },
          { id: "smtp",      label: "SMTP" },
          { id: "users",     label: "Utilisateurs" },
          { id: "audit",     label: "Journal d'audit" },
        ]} active={tab} onChange={setTab} />
      </div>

      {tab === "providers" && (
        <Card padding={0}>
          <div className="between" style={{ padding: "16px 20px" }}>
            <div>
              <div className="serif" style={{ fontSize: 18 }}>Fournisseurs d'identité</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Modifications appliquées à chaud (cache 60 s)</div>
            </div>
            <Button variant="primary" size="sm" icon="plus">Ajouter un fournisseur</Button>
          </div>
          {AUTH_PROVIDERS.map(p => (
            <div key={p.id} style={{ padding: "14px 20px", borderTop: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 8,
                background: p.enabled ? "var(--primary-soft)" : "var(--paper-2)",
                color: p.enabled ? "var(--primary)" : "var(--ink-3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
                border: "1px solid var(--hairline)",
              }}>{p.type.toUpperCase().slice(0, 4)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontSize: 14, color: "var(--ink)" }}>{p.displayName}</span>
                  {p.enabled ? <Pill tone="success" dot>actif</Pill> : <Pill tone="neutral">désactivé</Pill>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.details}</div>
              </div>
              <Switch checked={p.enabled} onChange={()=>{}} />
              <button style={{ color: "var(--ink-3)" }}><Icon name="edit" size={14} /></button>
            </div>
          ))}
        </Card>
      )}

      {tab === "smtp" && (
        <Card padding={20}>
          <div className="between" style={{ marginBottom: 14 }}>
            <div className="serif" style={{ fontSize: 18 }}>Configuration SMTP</div>
            <Pill tone="success" dot>Connecté</Pill>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Field label="Hôte"><Input defaultValue="smtp.mailgun.org" /></Field>
            <Field label="Port"><Input defaultValue="587" /></Field>
            <Field label="Utilisateur"><Input defaultValue="postmaster@dupont.fr" /></Field>
            <Field label="Mot de passe"><Input type="password" defaultValue="••••••••••••••" icon="lock" /></Field>
            <Field label="Expéditeur"><Input defaultValue="Bilan &lt;noreply@dupont.fr&gt;" /></Field>
            <Field label="TLS">
              <div style={{ display: "flex", alignItems: "center", gap: 10, height: 36 }}>
                <Switch checked={true} onChange={()=>{}} />
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>STARTTLS activé</span>
              </div>
            </Field>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <Button variant="primary" size="sm">Enregistrer</Button>
            <Button variant="secondary" size="sm" icon="mail">Envoyer un test</Button>
          </div>
        </Card>
      )}

      {tab === "users" && (
        <Card padding={0}>
          <div className="between" style={{ padding: "16px 20px" }}>
            <div>
              <div className="serif" style={{ fontSize: 18 }}>Utilisateurs · 2 actifs</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Mode d'inscription&#8239;: invitation uniquement</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Button variant="secondary" size="sm" icon="key">Jeton d'inscription</Button>
              <Button variant="primary" size="sm" icon="plus">Créer un utilisateur</Button>
            </div>
          </div>
          {HOUSEHOLD.members.map(m => (
            <div key={m.id} style={{ padding: "14px 20px", borderTop: "1px solid var(--hairline)", display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "auto 1fr auto auto auto auto", gap: 14, alignItems: "center" }}>
              <Avatar initials={m.initials} size={32} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: "var(--ink)" }}>{m.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{m.id === "u_pierre" ? "pierre.dupont@example.fr" : "claire.dupont@example.fr"}</div>
              </div>
              {!isMobile && <Pill tone={m.role === "OWNER" ? "primary" : "neutral"}>{m.role === "OWNER" ? "SUPER_ADMIN" : "USER"}</Pill>}
              {!isMobile && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>il y a 2 h</span>}
              {!isMobile && <Pill tone="success" dot>Actif</Pill>}
              <button style={{ color: "var(--ink-3)" }}><Icon name="more" size={16} /></button>
            </div>
          ))}
        </Card>
      )}

      {tab === "audit" && (
        <Card padding={0}>
          <div className="between" style={{ padding: "16px 20px" }}>
            <div>
              <div className="serif" style={{ fontSize: 18 }}>Journal d'audit</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Rétention&#8239;: 12 mois</div>
            </div>
            <Button variant="secondary" size="sm" icon="download">Exporter</Button>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "120px 130px 1fr 1fr 120px",
            gap: 12, padding: "10px 20px", background: "var(--paper-2)",
            fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)",
            borderTop: "1px solid var(--hairline)",
          }}>
            <span>Horodatage</span>
            {!isMobile && <span>Acteur</span>}
            {!isMobile && <span>Action</span>}
            <span>Cible</span>
            {!isMobile && <span>IP</span>}
          </div>
          {AUDIT.map((a, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "120px 130px 1fr 1fr 120px",
              gap: 12, padding: "10px 20px", alignItems: "center",
              borderTop: "1px solid var(--hairline)", fontSize: 12,
            }}>
              <span className="num" style={{ color: "var(--ink-3)" }}>{a.ts}</span>
              {!isMobile && <span style={{ color: "var(--ink-2)" }}>{a.actor}</span>}
              {!isMobile && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink)" }}>{a.action}</span>}
              <span style={{ color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.target}</span>
              {!isMobile && <span className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{a.ip}</span>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
};

Object.assign(window, { ImportScreen, AuthScreen, SettingsScreen, AdminScreen });
