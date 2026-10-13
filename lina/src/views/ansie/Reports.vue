<template>
  <Page>
    <div class="ansie-reports">
      <IBox class="toolbar-card no-print">
        <div class="toolbar">
          <div class="period">
            <span class="toolbar-label">Période</span>
            <div class="segmented" role="group">
              <button
                v-for="p in periods"
                :key="p.days"
                type="button"
                :class="{ active: preset === p.days }"
                @click="selectPreset(p.days)"
              >
                {{ p.label }}
              </button>
            </div>
            <el-date-picker
              v-model="range"
              type="daterange"
              unlink-panels
              range-separator="→"
              start-placeholder="Début"
              end-placeholder="Fin"
              :clearable="false"
              :disabled-date="(d) => d > new Date()"
              @change="preset = null"
            />
          </div>
          <div class="toolbar-actions">
            <el-button :loading="loading" @click="load">
              <el-icon><Refresh /></el-icon>
              <span>Actualiser</span>
            </el-button>
            <el-button type="primary" :disabled="loading" @click="print">
              <el-icon><Printer /></el-icon>
              <span>Imprimer / PDF</span>
            </el-button>
          </div>
        </div>
      </IBox>

      <div v-loading="loading" class="report-body">
        <header class="print-header">
          <img :src="logo" alt="" />
          <div>
            <h1>Rapport d'activité — {{ brandName }}</h1>
            <p>Du {{ fmtDay(range[0]) }} au {{ fmtDay(range[1]) }} · généré le {{ generatedAt }}</p>
          </div>
        </header>

        <div class="tiles">
          <div v-for="tile in tiles" :key="tile.label" class="tile" :class="tile.tone">
            <span class="tile-label">{{ tile.label }}</span>
            <span class="tile-value">{{ tile.value }}</span>
            <span class="tile-hint">{{ tile.hint }}</span>
          </div>
        </div>

        <section v-for="section in sections" :key="section.key" class="report-section">
          <div class="section-head">
            <div>
              <h3>{{ section.title }}</h3>
              <p>
                {{ section.data.rows.length }} ligne(s)
                <span v-if="section.data.truncated">
                  — limité aux {{ section.data.rows.length }} premières sur {{ section.data.total }}
                </span>
              </p>
            </div>
            <el-button
              class="no-print"
              :disabled="!section.data.rows.length"
              @click="exportCsv(section)"
            >
              <el-icon><Download /></el-icon>
              <span>Exporter CSV</span>
            </el-button>
          </div>
          <div v-if="section.error" class="section-error">{{ section.error }}</div>
          <el-table
            v-else
            :data="section.preview"
            size="small"
            :empty-text="'Aucune donnée sur la période'"
            class="report-table"
          >
            <el-table-column
              v-for="col in section.columns"
              :key="col.label"
              :label="col.label"
              :min-width="col.width || 120"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                <span :class="col.className && col.className(row)">{{
                  col.value ? col.value(row) : row[col.prop]
                }}</span>
              </template>
            </el-table-column>
          </el-table>
          <p v-if="section.data.rows.length > section.preview.length" class="more-rows">
            Aperçu des {{ section.preview.length }} dernières lignes — l'export CSV contient tout.
          </p>
        </section>
      </div>
    </div>
  </Page>
</template>

<script>
import IBox from '@/components/Common/IBox/index.vue'
import { Page } from '@/layout/components'
import defaultLogo from '@/assets/img/ansie_logo.png'
import { downloadCsv, fetchAll, formatDateTime, labelOf } from './utils'

const PREVIEW_ROWS = 15
const MAX_ROWS = 5000
const DANGEROUS_LEVEL = 4

const emptyData = () => ({ rows: [], total: 0, truncated: false })

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function riskLevel(row) {
  const level = row.risk_level
  return Number(typeof level === 'object' && level !== null ? level.value : level) || 0
}

function isSuccess(row) {
  const status = row.status
  const value = typeof status === 'object' && status !== null ? status.value : status
  return value === true || value === 1 || value === '1' || value === 'true'
}

export default {
  name: 'AnsieReports',
  components: { IBox, Page },
  data() {
    const today = new Date()
    return {
      loading: false,
      preset: 7,
      periods: [
        { days: 1, label: "Aujourd'hui" },
        { days: 7, label: '7 jours' },
        { days: 30, label: '30 jours' },
        { days: 90, label: '90 jours' }
      ],
      range: [new Date(today.getTime() - 6 * 86400000), today],
      generatedAt: '',
      logins: emptyData(),
      sessions: emptyData(),
      commands: emptyData(),
      errors: {}
    }
  },
  computed: {
    logo() {
      return this.$store.getters.publicSettings?.INTERFACE?.ansie?.logo || defaultLogo
    },
    brandName() {
      return this.$store.getters.publicSettings?.INTERFACE?.ansie?.brand_name || 'ANSIE'
    },
    failedLogins() {
      return this.logins.rows.filter((r) => !isSuccess(r)).length
    },
    dangerousCommands() {
      return this.commands.rows.filter((r) => riskLevel(r) >= DANGEROUS_LEVEL)
    },
    uniqueUsers() {
      return new Set(this.logins.rows.filter(isSuccess).map((r) => r.username)).size
    },
    tiles() {
      const total = this.logins.rows.length
      const failRate = total ? Math.round((this.failedLogins / total) * 100) : 0
      return [
        {
          label: 'Connexions',
          value: total,
          hint: `${this.uniqueUsers} utilisateur(s) distinct(s)`,
          tone: 'blue'
        },
        {
          label: 'Connexions échouées',
          value: this.failedLogins,
          hint: `${failRate} % des tentatives`,
          tone: this.failedLogins ? 'red' : 'green'
        },
        {
          label: 'Sessions sur les actifs',
          value: this.sessions.rows.length,
          hint: 'SSH, RDP, bases de données…',
          tone: 'blue'
        },
        {
          label: 'Commandes dangereuses',
          value: this.dangerousCommands.length,
          hint: `sur ${this.commands.rows.length} commande(s)`,
          tone: this.dangerousCommands.length ? 'red' : 'green'
        }
      ]
    },
    sections() {
      const make = (key, title, data, columns, rows = data.rows) => ({
        key,
        title,
        data: { ...data, rows },
        columns,
        preview: rows.slice(0, PREVIEW_ROWS),
        error: this.errors[key]
      })
      return [
        make('logins', 'Journal des connexions', this.logins, [
          { label: 'Date', value: (r) => formatDateTime(r.datetime), width: 140 },
          { label: 'Utilisateur', prop: 'username', width: 130 },
          { label: 'Adresse IP', prop: 'ip', width: 120 },
          { label: 'Ville', prop: 'city', width: 100 },
          { label: 'Type', value: (r) => labelOf(r.type), width: 80 },
          { label: 'MFA', value: (r) => labelOf(r.mfa), width: 80 },
          {
            label: 'Résultat',
            value: (r) => (isSuccess(r) ? 'Réussie' : 'Échouée'),
            className: (r) => (isSuccess(r) ? 'ok' : 'ko'),
            width: 90
          },
          { label: 'Motif', value: (r) => r.reason_display || labelOf(r.reason), width: 180 }
        ]),
        make('sessions', 'Sessions sur les actifs', this.sessions, [
          { label: 'Début', value: (r) => formatDateTime(r.date_start), width: 140 },
          { label: 'Fin', value: (r) => formatDateTime(r.date_end), width: 140 },
          { label: 'Utilisateur', value: (r) => labelOf(r.user), width: 150 },
          { label: 'Actif', value: (r) => labelOf(r.asset), width: 150 },
          { label: 'Compte', value: (r) => labelOf(r.account), width: 110 },
          { label: 'Protocole', value: (r) => labelOf(r.protocol), width: 90 },
          { label: 'Adresse IP', prop: 'remote_addr', width: 120 }
        ]),
        make(
          'commands',
          'Commandes dangereuses',
          this.commands,
          [
            {
              label: 'Date',
              value: (r) => formatDateTime(r.timestamp_display || r.timestamp),
              width: 140
            },
            { label: 'Utilisateur', value: (r) => labelOf(r.user), width: 150 },
            { label: 'Actif', value: (r) => labelOf(r.asset), width: 150 },
            { label: 'Compte', value: (r) => labelOf(r.account), width: 110 },
            { label: 'Commande', prop: 'input', width: 260 },
            {
              label: 'Niveau',
              value: (r) => labelOf(r.risk_level),
              className: () => 'ko',
              width: 100
            }
          ],
          this.dangerousCommands
        )
      ]
    }
  },
  mounted() {
    this.load()
  },
  methods: {
    fmtDay(date) {
      return date ? new Date(date).toLocaleDateString('fr-FR') : ''
    },
    selectPreset(days) {
      this.preset = days
      const today = new Date()
      this.range = [new Date(today.getTime() - (days - 1) * 86400000), today]
      this.load()
    },
    async fetchSection(key, url, params) {
      try {
        this[key] = await fetchAll(url, params, MAX_ROWS)
      } catch (error) {
        this[key] = emptyData()
        this.errors = {
          ...this.errors,
          [key]: 'Impossible de charger ces données (droits insuffisants ?).'
        }
      }
    },
    async load() {
      this.loading = true
      this.errors = {}
      const params = {
        date_from: startOfDay(this.range[0]).toISOString(),
        date_to: endOfDay(this.range[1]).toISOString(),
        order: '-date_start'
      }
      await Promise.all([
        this.fetchSection('logins', '/api/v1/audits/login-logs/', {
          ...params,
          order: '-datetime'
        }),
        this.fetchSection('sessions', '/api/v1/terminal/sessions/', params),
        this.fetchSection('commands', '/api/v1/terminal/commands/', {
          ...params,
          order: '-timestamp'
        })
      ])
      this.generatedAt = new Date().toLocaleString('fr-FR')
      this.loading = false
    },
    exportCsv(section) {
      const from = startOfDay(this.range[0]).toISOString().slice(0, 10)
      const to = endOfDay(this.range[1]).toISOString().slice(0, 10)
      downloadCsv(
        `${this.brandName}-${section.key}-${from}_${to}.csv`,
        section.columns,
        section.data.rows
      )
    },
    print() {
      window.print()
    }
  }
}
</script>

<style lang="scss" scoped>
.ansie-reports {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.period {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.toolbar-label {
  font-weight: 650;
  color: var(--color-text-primary);
}

.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: #e8eef7;
  border: 1px solid var(--color-border);

  button {
    padding: 6px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
    cursor: pointer;

    &.active {
      background: #fff;
      color: var(--color-primary);
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }
  }
}

.toolbar-actions {
  display: flex;
  gap: 8px;

  .el-button + .el-button {
    margin-left: 0;
  }

  .el-icon {
    margin-right: 6px;
  }
}

.report-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 200px;
}

.print-header {
  display: none;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 1000px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #fff;
  border-top: 3px solid var(--color-primary);
  box-shadow: 0 8px 24px -16px rgba(15, 23, 42, 0.25);

  &.green {
    border-top-color: var(--color-success);
  }

  &.red {
    border-top-color: var(--color-danger);

    .tile-value {
      color: var(--color-danger);
    }
  }
}

.tile-label {
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.tile-value {
  font-size: 28px;
  font-weight: 750;
  color: var(--color-text-primary);
  line-height: 1.15;
}

.tile-hint {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.report-section {
  padding: 18px 20px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 24px -16px rgba(15, 23, 42, 0.2);
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  .el-icon {
    margin-right: 6px;
  }
}

.section-error {
  padding: 12px;
  border-radius: 8px;
  background: #fdecec;
  color: #b42318;
  font-size: 13px;
}

.report-table {
  .ok {
    color: var(--color-success);
    font-weight: 600;
  }

  .ko {
    color: var(--color-danger);
    font-weight: 600;
  }
}

.more-rows {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>

<style lang="scss">
/* Print: only the report itself, on white paper. */
@media print {
  #app .navbar,
  #app .sidebar-container,
  #app .page-heading,
  #app .tags-view-container,
  .ansie-reports .no-print {
    display: none !important;
  }

  #app .app-wrapper {
    padding-top: 0 !important;
  }

  #app .main-container,
  #app .page,
  #app .wrapper-content {
    overflow: visible !important;
    height: auto !important;
    background: #fff !important;
  }

  .ansie-reports {
    .print-header {
      display: flex !important;
      align-items: center;
      gap: 14px;
      padding-bottom: 12px;
      border-bottom: 3px solid var(--color-primary);

      img {
        width: 56px;
        height: 56px;
        object-fit: contain;
      }

      h1 {
        margin: 0;
        font-size: 20px;
      }

      p {
        margin: 2px 0 0;
        font-size: 12px;
        color: #475569;
      }
    }

    .tile,
    .report-section {
      box-shadow: none !important;
      break-inside: avoid;
    }

    .tiles {
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    }
  }
}
</style>
