<template>
  <Page>
    <div v-loading="loading" class="ansie-security">
      <div class="top-row">
        <IBox class="score-card">
          <div class="score">
            <svg viewBox="0 0 120 120" class="ring" aria-hidden="true">
              <circle cx="60" cy="60" r="50" class="ring-track" />
              <circle
                cx="60"
                cy="60"
                r="50"
                class="ring-value"
                :class="scoreTone"
                :stroke-dasharray="`${(score / 100) * 314.16} 314.16`"
              />
            </svg>
            <div class="score-text">
              <span class="score-number">{{ score }}</span>
              <span class="score-unit">/ 100</span>
            </div>
          </div>
          <div class="score-info">
            <h3>Score de sécurité des comptes</h3>
            <p>{{ scoreMessage }}</p>
            <p class="score-detail">
              Calculé sur {{ totalUsers }} compte(s) : double authentification, mots de passe,
              comptes inactifs, expirés ou bloqués.
            </p>
            <el-button :loading="loading" @click="load">
              <el-icon><Refresh /></el-icon>
              <span>Actualiser</span>
            </el-button>
          </div>
        </IBox>

        <IBox class="tips-card">
          <h3>Priorités</h3>
          <ol v-if="priorities.length" class="tips">
            <li v-for="p in priorities" :key="p.key">
              <button type="button" @click="select(p.key)">
                <strong>{{ p.count }}</strong>
                {{ p.action }}
              </button>
            </li>
          </ol>
          <p v-else class="all-good">Aucun point à traiter. Bravo !</p>
        </IBox>
      </div>

      <div class="checks">
        <button
          v-for="check in checks"
          :key="check.key"
          type="button"
          class="check"
          :class="[check.level, { active: selected === check.key }]"
          @click="select(check.key)"
        >
          <span class="check-count">{{ counts[check.key] ?? '—' }}</span>
          <span class="check-title">{{ check.title }}</span>
          <span class="check-desc">{{ check.description }}</span>
          <span class="check-bar">
            <span :style="{ width: percent(check.key) + '%' }" />
          </span>
        </button>
      </div>

      <IBox v-if="selectedCheck" class="list-card">
        <div class="list-head">
          <div>
            <h3>{{ selectedCheck.title }}</h3>
            <p>{{ selectedCheck.advice }}</p>
          </div>
          <div class="list-actions">
            <el-button :disabled="!users.length" @click="exportUsers">
              <el-icon><Download /></el-icon>
              <span>Exporter CSV</span>
            </el-button>
            <el-button type="primary" @click="$router.push('/console/users/users')"
              >Gérer les utilisateurs</el-button
            >
          </div>
        </div>
        <el-table
          v-loading="listLoading"
          :data="users"
          size="small"
          empty-text="Aucun compte concerné"
        >
          <el-table-column label="Nom" prop="name" min-width="150" show-overflow-tooltip />
          <el-table-column
            label="Utilisateur"
            prop="username"
            min-width="130"
            show-overflow-tooltip
          />
          <el-table-column label="E-mail" prop="email" min-width="180" show-overflow-tooltip />
          <el-table-column label="Source" min-width="90">
            <template #default="{ row }">{{ labelOf(row.source) }}</template>
          </el-table-column>
          <el-table-column label="MFA" min-width="80">
            <template #default="{ row }">
              <span :class="row.mfa_enabled ? 'ok' : 'ko'">{{
                row.mfa_enabled ? 'Oui' : 'Non'
              }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Dernière connexion" min-width="140">
            <template #default="{ row }">{{ formatDateTime(row.last_login) || 'Jamais' }}</template>
          </el-table-column>
        </el-table>
        <p v-if="listTotal > users.length" class="more">
          {{ users.length }} premiers comptes affichés sur {{ listTotal }} — l'export CSV les
          contient tous.
        </p>
      </IBox>
    </div>
  </Page>
</template>

<script>
import IBox from '@/components/Common/IBox/index.vue'
import { Page } from '@/layout/components'
import { countOf, downloadCsv, fetchAll, formatDateTime, labelOf } from './utils'

const USERS_URL = '/api/v1/users/users/'
const LIST_PREVIEW = 50

// Each check: a user-list filter (same filters as the user list quick filters) and its weight in the score.
const CHECKS = [
  {
    key: 'no_mfa',
    title: 'Sans double authentification',
    description: 'Comptes sans MFA activée',
    advice: 'Activez la MFA pour ces comptes ou rendez-la obligatoire dans Paramètres → Sécurité.',
    action: 'compte(s) sans double authentification',
    params: { mfa_level: 0 },
    weight: 40,
    level: 'high'
  },
  {
    key: 'password_expired',
    title: 'Mot de passe expiré',
    description: 'Mot de passe à renouveler',
    advice: 'Demandez à ces utilisateurs de changer leur mot de passe à la prochaine connexion.',
    action: 'mot(s) de passe expiré(s)',
    params: { is_password_expired: true },
    weight: 20,
    level: 'medium'
  },
  {
    key: 'inactive_90',
    title: 'Inactifs depuis 90 jours',
    description: 'Aucune connexion depuis 3 mois',
    advice: 'Désactivez les comptes qui ne sont plus utilisés pour réduire la surface d’attaque.',
    action: 'compte(s) inactif(s) depuis 90 jours',
    params: { is_long_time_no_login: true, no_login_days: 90 },
    weight: 20,
    level: 'medium'
  },
  {
    key: 'never_login',
    title: 'Jamais connectés',
    description: 'Comptes créés mais jamais utilisés',
    advice: 'Vérifiez que ces comptes sont toujours nécessaires.',
    action: 'compte(s) jamais utilisé(s)',
    params: { is_first_login: true },
    weight: 10,
    level: 'low'
  },
  {
    key: 'expired',
    title: 'Comptes expirés',
    description: 'Date d’expiration dépassée',
    advice: 'Supprimez ou prolongez ces comptes selon le besoin.',
    action: 'compte(s) expiré(s) à nettoyer',
    params: { is_expired: true },
    weight: 5,
    level: 'low'
  },
  {
    key: 'blocked',
    title: 'Connexion bloquée',
    description: 'Trop d’échecs de connexion',
    advice: 'Contrôlez ces comptes : des échecs répétés peuvent signaler une attaque.',
    action: 'compte(s) bloqué(s) après des échecs',
    params: { is_login_blocked: true },
    weight: 5,
    level: 'high'
  }
]

export default {
  name: 'AnsieSecurityDashboard',
  components: { IBox, Page },
  data() {
    return {
      loading: true,
      listLoading: false,
      checks: CHECKS,
      totalUsers: 0,
      counts: {},
      selected: null,
      users: [],
      listTotal: 0
    }
  },
  computed: {
    selectedCheck() {
      return CHECKS.find((c) => c.key === this.selected)
    },
    score() {
      if (!this.totalUsers) return 100
      const penalty = CHECKS.reduce(
        (sum, c) => sum + c.weight * Math.min(1, (this.counts[c.key] || 0) / this.totalUsers),
        0
      )
      return Math.max(0, Math.round(100 - penalty))
    },
    scoreTone() {
      if (this.score >= 80) return 'good'
      if (this.score >= 50) return 'medium'
      return 'bad'
    },
    scoreMessage() {
      if (this.score >= 80) return 'Bon niveau. Traitez les points restants pour atteindre 100.'
      if (this.score >= 50) return 'Niveau moyen : plusieurs comptes présentent des risques.'
      return 'Niveau faible : traitez en priorité les comptes sans double authentification.'
    },
    priorities() {
      return CHECKS.filter((c) => this.counts[c.key] > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 4)
        .map((c) => ({ key: c.key, count: this.counts[c.key], action: c.action }))
    }
  },
  mounted() {
    this.load()
  },
  methods: {
    labelOf,
    formatDateTime,
    percent(key) {
      if (!this.totalUsers) return 0
      return Math.min(100, Math.round(((this.counts[key] || 0) / this.totalUsers) * 100))
    },
    async load() {
      this.loading = true
      try {
        const [total, ...values] = await Promise.all([
          countOf(USERS_URL),
          ...CHECKS.map((c) => countOf(USERS_URL, c.params).catch(() => null))
        ])
        this.totalUsers = total
        this.counts = Object.fromEntries(CHECKS.map((c, i) => [c.key, values[i]]))
        if (!this.selected) {
          this.selected = (CHECKS.find((c) => this.counts[c.key] > 0) || CHECKS[0]).key
        }
        await this.loadUsers()
      } finally {
        this.loading = false
      }
    },
    async select(key) {
      this.selected = key
      await this.loadUsers()
    },
    async loadUsers() {
      const check = this.selectedCheck
      if (!check) return
      this.listLoading = true
      try {
        const res = await this.$axios.get(USERS_URL, {
          params: { ...check.params, limit: LIST_PREVIEW, offset: 0 }
        })
        this.users = res?.results || res || []
        this.listTotal = res?.count ?? this.users.length
      } finally {
        this.listLoading = false
      }
    },
    async exportUsers() {
      const check = this.selectedCheck
      const { rows } = await fetchAll(USERS_URL, check.params)
      downloadCsv(
        `comptes-${check.key}.csv`,
        [
          { label: 'Nom', prop: 'name' },
          { label: 'Utilisateur', prop: 'username' },
          { label: 'E-mail', prop: 'email' },
          { label: 'Source', value: (r) => labelOf(r.source) },
          { label: 'MFA', value: (r) => (r.mfa_enabled ? 'Oui' : 'Non') },
          { label: 'Dernière connexion', value: (r) => formatDateTime(r.last_login) || 'Jamais' },
          { label: 'Date de création', value: (r) => formatDateTime(r.date_joined) }
        ],
        rows
      )
    }
  }
}
</script>

<style lang="scss" scoped>
.ansie-security {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.top-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 14px;

  @media (max-width: 1000px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.score-card :deep(.el-card__body) {
  flex-direction: row !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
}

.score {
  position: relative;
  width: 140px;
  height: 140px;
  flex-shrink: 0;
}

.ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);

  circle {
    fill: none;
    stroke-width: 12;
  }

  .ring-track {
    stroke: #e8eef7;
  }

  .ring-value {
    stroke-linecap: round;
    transition: stroke-dasharray 0.6s ease;
    stroke: var(--color-success);

    &.medium {
      stroke: var(--color-warning);
    }

    &.bad {
      stroke: var(--color-danger);
    }
  }
}

.score-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  padding-top: 48px;
}

.score-number {
  font-size: 36px;
  font-weight: 800;
  color: var(--color-text-primary);
}

.score-unit {
  margin-left: 2px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.score-info {
  flex: 1 1 260px;

  h3 {
    margin: 0 0 6px;
    font-size: 17px;
    font-weight: 750;
    color: var(--color-text-primary);
  }

  p {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--color-text-primary);
  }

  .score-detail {
    margin-bottom: 12px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  .el-icon {
    margin-right: 6px;
  }
}

.tips-card {
  h3 {
    margin: 0 0 10px;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-primary);
  }
}

.tips {
  margin: 0;
  padding-left: 18px;

  li {
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--color-text-primary);
  }

  button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover {
      color: var(--color-primary);
    }
  }

  strong {
    color: var(--color-danger);
  }
}

.all-good {
  margin: 0;
  color: var(--color-success);
  font-weight: 600;
}

.checks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 1100px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 600px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.check {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px 18px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 8px 24px -16px rgba(15, 23, 42, 0.25);
  transition:
    border-color 0.15s ease,
    transform 0.15s ease;

  --tone: var(--color-primary);

  &.high {
    --tone: var(--color-danger);
  }

  &.medium {
    --tone: var(--color-warning);
  }

  &:hover {
    transform: translateY(-1px);
    border-color: var(--tone);
  }

  &.active {
    border-color: var(--tone);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 18%, transparent);
  }
}

.check-count {
  font-size: 28px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--tone);
}

.check-title {
  font-weight: 700;
  color: var(--color-text-primary);
}

.check-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.check-bar {
  width: 100%;
  height: 6px;
  margin-top: 8px;
  border-radius: 99px;
  background: #e8eef7;
  overflow: hidden;

  span {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--tone);
  }
}

.list-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  h3 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  p {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-text-secondary);
  }
}

.list-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;

  .el-button + .el-button {
    margin-left: 0;
  }

  .el-icon {
    margin-right: 6px;
  }
}

.ok {
  color: var(--color-success);
  font-weight: 600;
}

.ko {
  color: var(--color-danger);
  font-weight: 600;
}

.more {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
