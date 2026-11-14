# Handoff rendering fixture

> Кожен `[ID]` — вузол `.requirements/current.argdown`. Тексти чинних вузлів наведено дослівно. Гілки, які не обрано, згорнуто в короткі висновки з переліком їхніх вузлів за ID; попередні версії перелічено за ID поруч із чинною.

## Намір

Exercise every class of the handoff projection.

## Межі

- Primary navigation
- 1\. A numbered-looking scope item
- \# A heading-looking scope item

## Обмеження

- **[C-008]** Navigation must stay usable with thirty workspaces. _(погоджено · інваріант)_
  - Джерела: користувач, намір: «Fixture scale envelope»
- **[C-012]** Navigation must never imply access to workspaces the user is not assigned to. _(перевірено · інваріант)_
  - Джерела: специфікація, нормативне: `specs/access.md` (Access contract; sha256: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)
- **[C-020]** Workspace colours should come from the design system. _(запропоновано)_
  - Походить від: [D-007]

## Факти

- **[E-021]** Users perform workflows that span workspaces. _(перевірено · наявне)_
  - Питання: [I-010]
  - Підтримує: [P-010B]
  - Джерела: користувач, намір: «Fixture scenario: daily cross-workspace work»
- **[E-050]** Thirty workspaces is the largest current tenant. _(перевірено)_
  - Підважує: [A-017]
  - Джерела: користувач, намір: «Fixture tenant list»

## Питання й рішення

### [I-001] How should navigation work within the access model?

_відкрите_

**Не обрано**

- \[x] Cross-workspace work is real, so this assumption was invalidated.
  - Гілка: [AS-003]

#### [I-010] What defines primary navigation?

_вирішене · рішення [D-007]_

**Рішення [D-007]** _(прийнято · підстава: намір користувача)_

> Use operations-first navigation with a persistent workspace switcher in the header.

- Обґрунтування: Supports cross-workspace work at the stated scale.
- Початкова підстава (чинну дає останній огляд): [E-021], [C-008], [C-012], [A-004]
- Альтернативи: [P-010A]
- Підтверджено оглядом **[V-002]** _(підтверджено)_: The choice still follows the current scope.
  - Обґрунтування: The current contracts suffice.
  - Спирається на: [C-008], [C-012]
- Наслідки:
  - **[Q-001]** Cross-workspace work needs a visible scope. _(чинний · цільове)_
  - The header shows the \<workspace> context.
  - \- a line that starts like a list item
- Джерела: користувач, намір: «Fixture agreement: "switcher in the header"»
- Попередні версії: [D-006]
- Попередні огляди: [V-001]
- Колишні наслідки: [Q-000]
- terms:
  - switcher: The workspace selector in the header
- rejection reasons: [P-010A]

**Обрано**

- **[P-010B]** Operational areas define navigation; a workspace is a context switcher. _(обрано)_
  - За: [E-021], [A-004]
  - Проти: [A-017]

**Аргументи**

- **[A-004]** A workspace hierarchy repeats navigation for cross-workspace work. _(чинний)_
  - Спирається на: [E-021], [C-008]
  - Підтримує: [P-010B]
- **[A-017]** The switcher costs one extra click when changing workspace. _(чинний)_
  - Заперечує: [P-010B]
  - Підважено: [E-050]

**Не обрано**

- A workspace hierarchy did not fit: thirty workspace roots need scrolling on every visit; the older click-cost wording gave way to A-017.
  - Гілка: [P-010A], [E-031], [I-030], [A-009]
- **[I-040]** Should workspaces have landing pages? _(зняте)_ — знято: Operations-first navigation removes the need for workspace landing pages.
  - Гілка: [P-040]

##### [I-014] What visual treatment marks the current workspace?

_відкладене · не блокує · #mvp_

- Не блокує: Visual styling can follow later.
- Відкладено: Waiting for the design system.

**Варіанти на розгляді**

- **[P-014A]** A coloured badge using --color-\* tokens, named \<domain>\_\<verb>\_\<object>, see `badge_color`. _(запропоновано)_

**Не обрано**

- A plain label was not distinctive enough.
  - Гілка: [P-014B]

#### [I-020] How is access assigned today?

_вирішене · відповідь [E-030]_

**Відповідь**

- **[E-030]** Access follows explicit assignments; see `assign()` and \[x] the AT&T \&amp; flags. _(перевірено)_
  - Джерела: код, спостережене: `src/access.ts` (assign(); ревізія: abc123)

**Не обрано**

- 1\. Roles were only a hypothesis; assignments are the recorded fact.
  - Гілка: [P-020]

## Припущення

- **[AS-001]** Most users switch workspace less than five times a day. _(не перевірено · не блокує)_
  - Перевірка: Measure with ten users.
  - Не блокує: It only tunes the switcher.
- **[AS-002]** Users know their workspace names. _(підтверджено)_
  - Перевірка: Analytics review.
  - Не блокує: Confirmed in research.

## Відкриті питання

- [I-014] _відкладене · не блокує_
