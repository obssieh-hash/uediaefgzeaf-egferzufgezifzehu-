<template>
  <div :class="{ collapse: collapse }" class="sidebar-logo-container">
    <transition name="sidebarLogoFade">
      <a v-if="collapse" key="collapse" class="sidebar-logo-link" @click="handleClick">
        <span v-if="isDefaultSymbol" class="ansie-logo-tile" role="img" aria-label="ANSIE">
          <img :src="ansieLogo" alt="ANSIE" class="sidebar-logo" />
        </span>
        <img v-else :src="logoSrc" alt="logo" class="sidebar-logo" />
      </a>
      <a v-else key="expand" class="sidebar-logo-link" @click="handleClick">
        <span v-if="isDefaultTextLogo" class="ansie-brand">
          <span class="ansie-logo-tile">
            <img :src="ansieLogo" alt="ANSIE" />
          </span>
          <span class="ansie-brand-text">
            <span class="ansie-brand-name">{{ brandName }}</span>
            <span class="ansie-brand-sub">JumpServer</span>
          </span>
        </span>
        <img v-else :src="logoTextSrc" alt="logo" class="sidebar-logo-text" />
      </a>
    </transition>
  </div>
</template>

<script>
import { mapGetters } from 'vuex'
import { getFirstAccessibleChildPath } from '@/utils/vue'
import defaultLogo from '@/assets/img/logo_text_white_spaced.png'
import defaultAnsieLogo from '@/assets/img/ansie_logo.png'
import { isDefaultInterfaceLogo } from '@/utils/interfaceLogo'

export default {
  name: 'SidebarLogo',
  props: {
    collapse: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    ...mapGetters(['viewRoutes', 'publicSettings']),
    ansieLogo() {
      return this.publicSettings.INTERFACE?.ansie?.logo || defaultAnsieLogo
    },
    brandName() {
      return this.publicSettings.INTERFACE?.ansie?.brand_name || 'ANSIE'
    },
    isDefaultTextLogo() {
      return isDefaultInterfaceLogo(this.publicSettings.INTERFACE?.logo_index)
    },
    logoTextSrc() {
      const logoIndex = this.publicSettings.INTERFACE?.logo_index
      return isDefaultInterfaceLogo(logoIndex) ? defaultLogo : logoIndex.trim()
    },
    isDefaultSymbol() {
      return isDefaultInterfaceLogo(this.logoSrc)
    },
    logoSrc() {
      return this.publicSettings.INTERFACE?.logo_logout?.trim()
    }
  },
  methods: {
    handleClick() {
      const currentPath = this.$route.path
      const matchingRoute = this.viewRoutes.find((route) => currentPath.startsWith(route.path))

      if (matchingRoute) {
        const redirect = matchingRoute.redirect
        const rootPath = matchingRoute.meta?.fullPath || matchingRoute.path
        const targetPath =
          (typeof redirect === 'string' && redirect) ||
          (redirect && typeof redirect === 'object' ? redirect : '') ||
          getFirstAccessibleChildPath(rootPath) ||
          rootPath
        this.$router.push(targetPath)
      } else {
        this.$router.push('/')
      }
    }
  }
}
</script>

<style lang="scss" scoped>
@use '@/styles/variables' as *;

.sidebarLogoFade-enter-active {
  transition: opacity 200ms ease-out;
}

.sidebarLogoFade-enter-from,
.sidebarLogoFade-leave-to {
  opacity: 0;
}

.sidebar-logo-container {
  position: relative;
  width: 100%;
  height: $headerHeight;
  text-align: center;
  overflow: hidden;

  & .sidebar-logo-link {
    height: 100%;
    width: 100%;
    padding: 5px;
    display: flex;
    align-items: center;
    justify-content: center;

    & .sidebar-logo {
      color: #fff;
      width: 32px;
      height: 32px;
      vertical-align: middle;
      margin-right: 0;
    }

    & .sidebar-logo-text {
      display: block;
      height: calc(#{$headerHeight} - 10px);
      width: auto;
      max-width: 100%;
      object-fit: contain;
    }
  }

  & .ansie-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  & .ansie-logo-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    padding: 2px;
    border-radius: 10px;
    background: #fff;
    box-shadow:
      0 4px 12px -4px rgba(2, 20, 50, 0.45),
      0 0 0 2px rgba(255, 255, 255, 0.18);

    img {
      display: block;
      width: 100%;
      height: 100%;
      margin: 0;
      object-fit: contain;
    }
  }

  & .ansie-brand-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.1;
    color: #fff;
  }

  & .ansie-brand-name {
    max-width: 140px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.12em;
  }

  & .ansie-brand-sub {
    margin-top: 2px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--color-success, #0a9a25) 50%, #fff);
  }

  &.collapse {
    height: $headerHeight;
    .sidebar-logo {
      margin-right: 0;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebarLogoFade-enter-active {
    transition: none;
  }
}
</style>
