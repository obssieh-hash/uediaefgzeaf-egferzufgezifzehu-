<template>
  <Page>
    <div v-loading="loading" class="ansie-rules">
      <IBox class="intro-card">
        <div class="intro">
          <div class="intro-text">
            <h3>Restrictions de connexion</h3>
            <p>
              Autorisez ou bloquez les connexions selon l'utilisateur, l'adresse IP, le jour et
              l'heure. Les règles sont lues de haut en bas :
              <strong>la première qui correspond décide</strong>. Si aucune règle ne correspond, la
              connexion est autorisée.
            </p>
          </div>
          <div class="intro-switches">
            <label class="switch-row">
              <el-switch v-model="enabled" />
              <span>
                <strong>Activer les restrictions</strong>
                <small>{{
                  enabled
                    ? 'Les règles ci-dessous sont appliquées.'
                    : 'Aucune règle n’est appliquée.'
                }}</small>
              </span>
            </label>
            <label class="switch-row">
              <el-switch v-model="exemptSuperuser" />
              <span>
                <strong>Ne jamais bloquer les super-administrateurs</strong>
                <small>Recommandé : évite de perdre l'accès si une règle est trop stricte.</small>
              </span>
            </label>
          </div>
        </div>
        <el-alert
          v-if="enabled && !exemptSuperuser && hasDenyAll"
          type="warning"
          show-icon
          :closable="false"
          title="Une règle bloque tout le monde et les super-administrateurs ne sont pas exemptés : vérifiez que vous pourrez encore vous connecter."
        />
      </IBox>

      <div class="rules-head">
        <h4>Règles ({{ rules.length }})</h4>
        <el-button type="primary" @click="addRule">
          <el-icon><Plus /></el-icon>
          <span>Ajouter une règle</span>
        </el-button>
      </div>

      <div v-if="!rules.length" class="empty">
        <p>Aucune règle pour le moment.</p>
        <p class="examples-title">Exemples à ajouter en un clic :</p>
        <div class="examples">
          <el-button v-for="ex in examples" :key="ex.label" @click="addExample(ex)">{{
            ex.label
          }}</el-button>
        </div>
      </div>

      <IBox
        v-for="(rule, index) in rules"
        :key="rule._key"
        class="rule-card"
        :class="[rule.action, { disabled: !rule.enabled }]"
      >
        <div class="rule-top">
          <span class="rule-index">{{ index + 1 }}</span>
          <el-input
            v-model="rule.name"
            class="rule-name"
            maxlength="64"
            placeholder="Nom de la règle"
          />
          <div class="action-switch" role="group">
            <button
              type="button"
              :class="{ active: rule.action === 'allow' }"
              @click="rule.action = 'allow'"
            >
              Autoriser
            </button>
            <button
              type="button"
              class="deny"
              :class="{ active: rule.action === 'deny' }"
              @click="rule.action = 'deny'"
            >
              Bloquer
            </button>
          </div>
          <el-switch v-model="rule.enabled" title="Activer / désactiver" />
          <div class="rule-tools">
            <el-button text :disabled="index === 0" title="Monter" @click="move(index, -1)">
              <el-icon><ArrowUp /></el-icon>
            </el-button>
            <el-button
              text
              :disabled="index === rules.length - 1"
              title="Descendre"
              @click="move(index, 1)"
            >
              <el-icon><ArrowDown /></el-icon>
            </el-button>
            <el-button text type="danger" title="Supprimer" @click="rules.splice(index, 1)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </div>

        <p class="rule-summary">{{ summary(rule) }}</p>

        <div class="rule-grid">
          <div class="field">
            <label>Utilisateurs</label>
            <el-select
              v-model="rule.users"
              multiple
              filterable
              allow-create
              default-first-option
              :reserve-keyword="false"
              placeholder="* = tous les utilisateurs"
            >
              <el-option label="Tous les utilisateurs (*)" value="*" />
            </el-select>
            <small>Noms d'utilisateur. Laissez vide ou * pour tout le monde.</small>
            <div v-if="fieldError(index, 'users')" class="field-error">
              {{ fieldError(index, 'users') }}
            </div>
          </div>
          <div class="field">
            <label>Adresses IP</label>
            <el-select
              v-model="rule.ip_ranges"
              multiple
              filterable
              allow-create
              default-first-option
              :reserve-keyword="false"
              placeholder="* = toutes les adresses"
            >
              <el-option label="Toutes les adresses (*)" value="*" />
            </el-select>
            <small>IP, réseau (10.0.0.0/8) ou plage (10.0.0.1-10.0.0.50).</small>
            <div v-if="fieldError(index, 'ip_ranges')" class="field-error">
              {{ fieldError(index, 'ip_ranges') }}
            </div>
          </div>
          <div class="field">
            <label>Jours</label>
            <el-checkbox-group v-model="rule.weekdays" class="days">
              <el-checkbox-button v-for="d in weekdays" :key="d.value" :value="d.value">{{
                d.short
              }}</el-checkbox-button>
            </el-checkbox-group>
            <small>Aucun jour coché = tous les jours.</small>
          </div>
          <div class="field">
            <label>Heures</label>
            <div class="hours">
              <el-time-select
                v-model="rule.time_start"
                start="00:00"
                step="00:30"
                end="23:30"
                placeholder="Début"
              />
              <span>→</span>
              <el-time-select
                v-model="rule.time_end"
                start="00:00"
                step="00:30"
                end="23:59"
                placeholder="Fin"
              />
            </div>
            <small>Vide = toute la journée. 22:00 → 06:00 couvre la nuit.</small>
            <div
              v-if="fieldError(index, 'time_start') || fieldError(index, 'time_end')"
              class="field-error"
            >
              {{ fieldError(index, 'time_start') || fieldError(index, 'time_end') }}
            </div>
          </div>
          <div v-if="rule.action === 'deny'" class="field wide">
            <label>Message affiché à l'utilisateur bloqué</label>
            <el-input
              v-model="rule.message"
              maxlength="200"
              placeholder="Connexion non autorisée depuis cette adresse ou à cette heure"
            />
          </div>
        </div>
        <div v-if="fieldError(index, 'name')" class="field-error">
          Nom : {{ fieldError(index, 'name') }}
        </div>
      </IBox>

      <div class="save-bar">
        <span v-if="dirty" class="dirty">Modifications non enregistrées</span>
        <el-button @click="load">Annuler</el-button>
        <el-button type="primary" :loading="saving" @click="save">Enregistrer les règles</el-button>
      </div>
    </div>
  </Page>
</template>

<script>
import IBox from '@/components/Common/IBox/index.vue'
import { Page } from '@/layout/components'
import { WEEKDAYS } from './utils'

const URL = '/api/v1/settings/setting/?category=ansie_login_rules'
let keySeed = 0

function newRule(values = {}) {
  keySeed += 1
  return {
    _key: keySeed,
    name: '',
    enabled: true,
    action: 'deny',
    users: ['*'],
    ip_ranges: ['*'],
    weekdays: [],
    time_start: '',
    time_end: '',
    message: '',
    ...values
  }
}

function listText(values, all, one, many) {
  const items = (values || []).filter(Boolean)
  if (!items.length || items.includes('*')) return all
  return items.length === 1 ? `${one} ${items[0]}` : `${many} ${items.join(', ')}`
}

export default {
  name: 'AnsieLoginRules',
  components: { IBox, Page },
  data() {
    return {
      loading: true,
      saving: false,
      enabled: false,
      exemptSuperuser: true,
      rules: [],
      errors: [],
      snapshot: '',
      weekdays: WEEKDAYS,
      examples: [
        {
          label: 'Réseau interne uniquement',
          rules: [
            {
              name: 'Réseau interne',
              action: 'allow',
              ip_ranges: ['10.0.0.0/8', '192.168.0.0/16']
            },
            {
              name: 'Tout le reste',
              action: 'deny',
              message: 'Connexion autorisée uniquement depuis le réseau interne.'
            }
          ]
        },
        {
          label: 'Heures de bureau (lun–ven, 7 h–19 h)',
          rules: [
            {
              name: 'Heures de bureau',
              action: 'allow',
              weekdays: [1, 2, 3, 4, 5],
              time_start: '07:00',
              time_end: '19:00'
            },
            {
              name: 'Hors heures de bureau',
              action: 'deny',
              message: 'Connexion autorisée du lundi au vendredi, de 7 h à 19 h.'
            }
          ]
        },
        {
          label: 'Bloquer la nuit (22 h–6 h)',
          rules: [
            {
              name: 'Nuit',
              action: 'deny',
              time_start: '22:00',
              time_end: '06:00',
              message: 'Connexion impossible entre 22 h et 6 h.'
            }
          ]
        }
      ]
    }
  },
  computed: {
    payload() {
      return {
        ANSIE_LOGIN_RULES_ENABLED: this.enabled,
        ANSIE_LOGIN_RULES_EXEMPT_SUPERUSER: this.exemptSuperuser,
        ANSIE_LOGIN_RULES: this.rules.map(({ _key, ...rule }) => ({
          ...rule,
          time_start: rule.time_start || '',
          time_end: rule.time_end || ''
        }))
      }
    },
    dirty() {
      return !this.loading && JSON.stringify(this.payload) !== this.snapshot
    },
    hasDenyAll() {
      return this.rules.some(
        (r) =>
          r.enabled &&
          r.action === 'deny' &&
          (!r.users.length || r.users.includes('*')) &&
          (!r.ip_ranges.length || r.ip_ranges.includes('*')) &&
          !r.weekdays.length &&
          !r.time_start &&
          !r.time_end
      )
    }
  },
  mounted() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      this.errors = []
      try {
        const data = await this.$axios.get(URL)
        this.enabled = !!data.ANSIE_LOGIN_RULES_ENABLED
        this.exemptSuperuser = data.ANSIE_LOGIN_RULES_EXEMPT_SUPERUSER !== false
        this.rules = (data.ANSIE_LOGIN_RULES || []).map((rule) => newRule(rule))
      } finally {
        this.loading = false
        this.$nextTick(() => {
          this.snapshot = JSON.stringify(this.payload)
        })
      }
    },
    addRule() {
      this.rules.push(newRule({ name: `Règle ${this.rules.length + 1}` }))
    },
    addExample(example) {
      example.rules.forEach((rule) => this.rules.push(newRule(rule)))
    },
    move(index, delta) {
      const [rule] = this.rules.splice(index, 1)
      this.rules.splice(index + delta, 0, rule)
    },
    fieldError(index, field) {
      const value = this.errors?.[index]?.[field]
      if (!value) return ''
      return Array.isArray(value)
        ? value.join(' ')
        : typeof value === 'object'
          ? Object.values(value).join(' ')
          : value
    },
    summary(rule) {
      const verb = rule.action === 'allow' ? 'Autorise' : 'Bloque'
      const who = listText(rule.users, 'tous les utilisateurs', "l'utilisateur", 'les utilisateurs')
      const where = listText(rule.ip_ranges, 'depuis toute adresse', 'depuis', 'depuis')
      const days = rule.weekdays.length
        ? 'le ' +
          WEEKDAYS.filter((d) => rule.weekdays.includes(d.value))
            .map((d) => d.label)
            .join(', ')
        : 'tous les jours'
      const hours =
        rule.time_start || rule.time_end
          ? `de ${rule.time_start || '00:00'} à ${rule.time_end || '23:59'}`
          : 'à toute heure'
      const state = rule.enabled ? '' : ' (désactivée)'
      return `${verb} ${who} ${where}, ${days}, ${hours}${state}.`
    },
    async save() {
      if (this.rules.some((r) => !r.name.trim())) {
        this.$message.error('Chaque règle doit avoir un nom.')
        return
      }
      this.saving = true
      this.errors = []
      try {
        await this.$axios.patch(URL, this.payload, { disableFlashErrorMsg: true })
        this.snapshot = JSON.stringify(this.payload)
        this.$message.success('Règles enregistrées et appliquées immédiatement')
      } catch (error) {
        const data = error?.response?.data || {}
        this.errors = Array.isArray(data.ANSIE_LOGIN_RULES) ? data.ANSIE_LOGIN_RULES : []
        this.$message.error("L'enregistrement a échoué : vérifiez les champs signalés.")
      } finally {
        this.saving = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.ansie-rules {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 64px;
}

.intro {
  display: flex;
  flex-wrap: wrap;
  gap: 20px 32px;
  justify-content: space-between;
  margin-bottom: 4px;
}

.intro-text {
  flex: 1 1 380px;

  h3 {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
}

.intro-switches {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 0 1 380px;
}

.switch-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;

  span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  strong {
    font-size: 13px;
    color: var(--color-text-primary);
  }

  small {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
}

.intro-card :deep(.el-alert) {
  margin-top: 14px;
}

.rules-head {
  display: flex;
  align-items: center;
  justify-content: space-between;

  h4 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .el-icon {
    margin-right: 6px;
  }
}

.empty {
  padding: 32px 20px;
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: 14px;
  background: #fff;
  color: var(--color-text-secondary);

  p {
    margin: 0 0 6px;
  }

  .examples-title {
    margin-top: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 10px;

    .el-button + .el-button {
      margin-left: 0;
    }
  }
}

.rule-card {
  border-left: 4px solid var(--color-success);

  &.deny {
    border-left-color: var(--color-danger);
  }

  &.disabled {
    opacity: 0.65;
  }
}

.rule-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.rule-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  font-weight: 700;
  font-size: 12px;
}

.rule-name {
  flex: 1 1 220px;
  max-width: 360px;

  :deep(.el-input__inner) {
    font-weight: 650;
  }
}

.action-switch {
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: #e8eef7;

  button {
    padding: 6px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;

    &.active {
      background: #fff;
      color: var(--color-success);
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }

    &.deny.active {
      color: var(--color-danger);
    }
  }
}

.rule-tools {
  display: flex;
  margin-left: auto;

  .el-button + .el-button {
    margin-left: 0;
  }
}

.rule-summary {
  margin: 12px 0 14px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f5f8fc;
  font-size: 12.5px;
  color: var(--color-text-secondary);
}

.rule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 20px;

  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;

  &.wide {
    grid-column: 1 / -1;
  }

  label {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--color-text-primary);
  }

  small {
    font-size: 11.5px;
    color: var(--color-text-secondary);
  }
}

.field-error {
  font-size: 12px;
  color: var(--color-danger);
}

.days {
  display: flex;
  flex-wrap: wrap;
}

.hours {
  display: flex;
  align-items: center;
  gap: 8px;

  span {
    color: var(--color-text-secondary);
  }
}

.save-bar {
  position: sticky;
  bottom: 0;
  z-index: 3;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  box-shadow: 0 -8px 24px -16px rgba(15, 23, 42, 0.3);

  .dirty {
    margin-right: auto;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-warning);
  }

  .el-button + .el-button {
    margin-left: 0;
  }
}
</style>
