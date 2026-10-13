<template>
  <Page>
    <div v-loading="loading" class="ansie-custom">
      <IBox class="ansie-card form-card">
        <div class="card-head">
          <h3>Identité visuelle</h3>
          <p>Logo, nom et couleurs utilisés sur la page de connexion, la console et les e-mails.</p>
        </div>

        <el-form label-position="top" class="custom-form" @submit.prevent>
          <div class="logo-row">
            <div class="logo-preview">
              <img :src="logoSrc" alt="Logo" />
            </div>
            <div class="logo-actions">
              <div class="field-label">Logo</div>
              <div class="field-help">
                PNG, JPEG, WebP ou SVG, 500 Ko au maximum. Format carré conseillé.
              </div>
              <div class="logo-buttons">
                <el-button type="primary" plain @click="$refs.logoInput.click()">
                  <el-icon><Upload /></el-icon>
                  <span>Choisir une image</span>
                </el-button>
                <el-button v-if="form.ANSIE_LOGO" @click="form.ANSIE_LOGO = ''"
                  >Logo par défaut</el-button
                >
              </div>
              <input
                ref="logoInput"
                class="hidden-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                @change="onLogoSelected"
              />
              <div v-if="errors.ANSIE_LOGO" class="field-error">{{ errors.ANSIE_LOGO }}</div>
            </div>
          </div>

          <div class="grid-2">
            <el-form-item label="Nom court" :error="errors.ANSIE_BRAND_NAME">
              <el-input v-model="form.ANSIE_BRAND_NAME" maxlength="32" placeholder="ANSIE" />
            </el-form-item>
            <el-form-item label="Titre de la plateforme" :error="errors.ANSIE_LOGIN_TITLE">
              <el-input
                v-model="form.ANSIE_LOGIN_TITLE"
                maxlength="128"
                placeholder="Titre par défaut de JumpServer"
              />
            </el-form-item>
          </div>

          <el-form-item label="Nom de l'organisation" :error="errors.ANSIE_BRAND_SUBTITLE">
            <el-input v-model="form.ANSIE_BRAND_SUBTITLE" maxlength="128" />
          </el-form-item>

          <el-form-item
            label="Message de la page de connexion"
            :error="errors.ANSIE_LOGIN_DESCRIPTION"
          >
            <el-input
              v-model="form.ANSIE_LOGIN_DESCRIPTION"
              type="textarea"
              :rows="3"
              maxlength="400"
              show-word-limit
            />
          </el-form-item>

          <div class="grid-2">
            <el-form-item label="Couleur principale" :error="errors.ANSIE_PRIMARY_COLOR">
              <div class="color-field">
                <el-color-picker v-model="form.ANSIE_PRIMARY_COLOR" :predefine="presets.primary" />
                <el-input v-model="form.ANSIE_PRIMARY_COLOR" maxlength="7" class="color-input" />
              </div>
            </el-form-item>
            <el-form-item label="Couleur d'accent" :error="errors.ANSIE_ACCENT_COLOR">
              <div class="color-field">
                <el-color-picker v-model="form.ANSIE_ACCENT_COLOR" :predefine="presets.accent" />
                <el-input v-model="form.ANSIE_ACCENT_COLOR" maxlength="7" class="color-input" />
              </div>
            </el-form-item>
          </div>

          <div class="form-actions">
            <el-button type="primary" :loading="saving" @click="save">Enregistrer</el-button>
            <el-button @click="restoreDefaults">Couleurs ANSIE par défaut</el-button>
            <el-button text @click="load">Annuler les modifications</el-button>
          </div>
        </el-form>
      </IBox>

      <IBox class="ansie-card preview-card">
        <div class="card-head">
          <h3>Aperçu</h3>
          <p>Mise à jour en direct. Les changements s'appliquent après l'enregistrement.</p>
        </div>

        <div class="preview-header" :style="previewVars">
          <span class="preview-logo"><img :src="logoSrc" alt="" /></span>
          <span class="preview-brand">
            <strong>{{ form.ANSIE_BRAND_NAME || 'ANSIE' }}</strong>
            <small>JumpServer</small>
          </span>
          <span class="preview-search" />
        </div>

        <div class="preview-login" :style="previewVars">
          <div class="preview-form">
            <div class="preview-title">{{ form.ANSIE_LOGIN_TITLE || 'JumpServer' }}</div>
            <div class="preview-input" />
            <div class="preview-input" />
            <div class="preview-button">Connexion</div>
          </div>
          <div class="preview-panel">
            <span class="preview-panel-logo"><img :src="logoSrc" alt="" /></span>
            <div class="preview-panel-title">{{ form.ANSIE_BRAND_SUBTITLE }}</div>
            <div class="preview-panel-text">{{ form.ANSIE_LOGIN_DESCRIPTION }}</div>
          </div>
        </div>
      </IBox>
    </div>
  </Page>
</template>

<script>
import IBox from '@/components/Common/IBox/index.vue'
import { Page } from '@/layout/components'
import defaultLogo from '@/assets/img/ansie_logo.png'

const URL = '/api/v1/settings/setting/?category=ansie_interface'
const MAX_LOGO_BYTES = 500 * 1024
const HEX = /^#[0-9a-fA-F]{6}$/
const DEFAULT_COLORS = { ANSIE_PRIMARY_COLOR: '#0b4ea2', ANSIE_ACCENT_COLOR: '#0a9a25' }

function mix(hex, other, weight) {
  if (!HEX.test(hex || '')) return hex
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const b = [1, 3, 5].map((i) => parseInt(other.slice(i, i + 2), 16))
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * weight)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

export default {
  name: 'AnsieCustomization',
  components: { IBox, Page },
  data() {
    return {
      loading: true,
      saving: false,
      form: {
        ANSIE_BRAND_NAME: '',
        ANSIE_BRAND_SUBTITLE: '',
        ANSIE_LOGIN_TITLE: '',
        ANSIE_LOGIN_DESCRIPTION: '',
        ANSIE_LOGO: '',
        ...DEFAULT_COLORS
      },
      errors: {},
      presets: {
        primary: ['#0b4ea2', '#033d80', '#1e6fd9', '#0f766e', '#7a1fa2', '#b42318'],
        accent: ['#0a9a25', '#22b33f', '#f59e0b', '#0ea5e9', '#e11d48', '#64748b']
      }
    }
  },
  computed: {
    logoSrc() {
      return this.form.ANSIE_LOGO || defaultLogo
    },
    previewVars() {
      const primary = HEX.test(this.form.ANSIE_PRIMARY_COLOR)
        ? this.form.ANSIE_PRIMARY_COLOR
        : '#0b4ea2'
      const accent = HEX.test(this.form.ANSIE_ACCENT_COLOR)
        ? this.form.ANSIE_ACCENT_COLOR
        : '#0a9a25'
      return {
        '--p': primary,
        '--p-dark': mix(primary, '#000000', 0.3),
        '--p-deep': mix(primary, '#000000', 0.45),
        '--a': accent
      }
    }
  },
  mounted() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      this.errors = {}
      try {
        const data = await this.$axios.get(URL)
        Object.keys(this.form).forEach((key) => {
          if (data[key] !== undefined && data[key] !== null) this.form[key] = data[key]
        })
      } finally {
        this.loading = false
      }
    },
    restoreDefaults() {
      Object.assign(this.form, DEFAULT_COLORS)
    },
    onLogoSelected(event) {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
        this.errors = { ...this.errors, ANSIE_LOGO: 'Format non pris en charge.' }
        return
      }
      if (file.size > MAX_LOGO_BYTES) {
        this.errors = { ...this.errors, ANSIE_LOGO: "L'image dépasse 500 Ko." }
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        this.form.ANSIE_LOGO = reader.result
        this.errors = { ...this.errors, ANSIE_LOGO: '' }
      }
      reader.readAsDataURL(file)
    },
    async save() {
      this.saving = true
      this.errors = {}
      try {
        await this.$axios.patch(URL, this.form, { disableFlashErrorMsg: true })
        // Reload the public settings so the console picks up the new logo and colours now.
        await this.$store.dispatch('settings/getPublicSettings', false)
        this.$message.success('Personnalisation enregistrée')
      } catch (error) {
        const data = error?.response?.data || {}
        this.errors = Object.fromEntries(
          Object.entries(data).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(' ') : String(value)
          ])
        )
        this.$message.error("L'enregistrement a échoué : vérifiez les champs signalés.")
      } finally {
        this.saving = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.ansie-custom {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;

  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.card-head {
  margin-bottom: 18px;

  h3 {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  p {
    margin: 0;
    font-size: 13px;
    color: var(--color-text-secondary);
  }
}

.logo-row {
  display: flex;
  gap: 18px;
  align-items: center;
  margin-bottom: 18px;
  padding: 16px;
  border: 1px dashed var(--color-border);
  border-radius: 12px;
  background: #f8fafc;
}

.logo-preview {
  flex-shrink: 0;
  width: 84px;
  height: 84px;
  padding: 6px;
  border-radius: 18px;
  background: #fff;
  border: 1px solid var(--color-border);
  box-shadow: 0 4px 12px -6px rgba(15, 23, 42, 0.25);

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.field-label {
  font-weight: 650;
  color: var(--color-text-primary);
}

.field-help {
  margin: 2px 0 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.field-error {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-danger);
}

.logo-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  .el-button + .el-button {
    margin-left: 0;
  }

  .el-icon {
    margin-right: 6px;
  }
}

.hidden-input {
  display: none;
}

.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;

  @media (max-width: 640px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.custom-form :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--color-text-primary);
}

.color-field {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;

  .color-input {
    max-width: 130px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;

  .el-button + .el-button {
    margin-left: 0;
  }
}

/* ---------- Preview ---------- */

.preview-header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 14px;
  border-radius: 12px 12px 0 0;
  background: linear-gradient(90deg, var(--p-deep), var(--p-dark) 35%, var(--p));
  border-bottom: 3px solid var(--a);
  color: #fff;
}

.preview-logo {
  width: 34px;
  height: 34px;
  padding: 2px;
  border-radius: 9px;
  background: #fff;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.preview-brand {
  display: flex;
  flex-direction: column;
  line-height: 1.1;

  strong {
    font-size: 14px;
    letter-spacing: 0.1em;
  }

  small {
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--a) 55%, #fff);
  }
}

.preview-search {
  margin-left: auto;
  width: 120px;
  height: 24px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.16);
}

.preview-login {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-top: 0;
  border-radius: 0 0 12px 12px;
  background: #f3f6fb;
}

.preview-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 12px;
  background: #fff;
}

.preview-title {
  margin-bottom: 4px;
  font-weight: 700;
  font-size: 13px;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.preview-input {
  height: 22px;
  border-radius: 7px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}

.preview-button {
  height: 26px;
  border-radius: 7px;
  background: linear-gradient(
    135deg,
    var(--p),
    var(--p-dark) 55%,
    color-mix(in srgb, var(--a) 70%, #000)
  );
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 26px;
  text-align: center;
}

.preview-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(135deg, var(--p-dark) 0%, var(--p) 50%, var(--a) 100%);
}

.preview-panel-logo {
  width: 40px;
  height: 40px;
  padding: 3px;
  border-radius: 11px;
  background: #fff;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.preview-panel-title {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
}

.preview-panel-text {
  font-size: 10.5px;
  line-height: 1.45;
  opacity: 0.85;
}
</style>
