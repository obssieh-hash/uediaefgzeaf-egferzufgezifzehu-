<template>
  <span class="switch" role="group">
    <button
      v-for="i in iOptions"
      :key="i.value"
      type="button"
      class="switch-date-button"
      :class="{ 'is-active': String(i.value) === String(select) }"
      :aria-pressed="String(i.value) === String(select)"
      @click="onChange(i.value)"
    >
      {{ i.label }}
    </button>
  </span>
</template>

<script>
import { scopedLocalStorage as localStorage } from '@/utils/storage'

export default {
  props: {
    name: {
      type: String,
      default: 'dashboardDays'
    },
    days: {
      type: [String, Number],
      default: null
    },
    options: {
      type: Array,
      default: () => []
    }
  },
  data() {
    const defaultOptions = [
      {
        label: this.$t('Today'),
        value: '1'
      },
      {
        label: this.$t('Last7Days'),
        value: '7'
      },
      {
        label: this.$t('Last30Days'),
        value: '30'
      }
    ]
    return {
      select: this.days == null ? null : String(this.days),
      iOptions: this.options.length > 0 ? this.options : defaultOptions
    }
  },
  watch: {
    days(val) {
      if (val != null && String(val) !== this.select) {
        this.select = String(val)
      }
    }
  },
  created() {
    let days = this.days
    if (!days) {
      days = this.$route.query.days
    }
    if (!days) {
      days = localStorage.getItem(this.name)
    }
    if (!days) {
      days = '7'
    }
    if (days && String(days) !== this.select) {
      this.select = String(days)
      this.$emit('change', this.select)
    }
  },
  mounted() {
    this.$emit('change', this.select)
  },
  methods: {
    onChange(val) {
      const days = String(val)
      this.select = days
      localStorage.setItem(this.name, days)
      this.$emit('change', days)
    }
  }
}
</script>

<style lang="scss" scoped>
.switch {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  font-weight: 400;
  vertical-align: middle;
  background: #e8eef7;
  border: 1px solid var(--color-border);
  border-radius: 10px;

  .switch-date-button {
    min-width: 64px;
    height: 28px;
    padding: 7px 15px;
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    color: var(--color-text-secondary);
    cursor: pointer;
    background: transparent;
    border: none;
    border-radius: 8px;
    outline: none;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      box-shadow 0.15s ease;

    &:first-child {
      margin-left: 0;
    }

    &:hover,
    &:focus-visible {
      position: relative;
      z-index: 1;
      color: var(--color-primary);
      background: rgba(255, 255, 255, 0.6);
    }

    &.is-active {
      position: relative;
      z-index: 2;
      color: var(--color-primary);
      background: #fff;
      box-shadow:
        0 1px 3px rgba(15, 23, 42, 0.12),
        0 0 0 1px rgba(11, 78, 162, 0.08);
    }
  }
}
</style>
