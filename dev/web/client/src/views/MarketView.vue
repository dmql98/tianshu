<script setup lang="ts">
</script>

<template>
  <div class="market-view">
    <div class="market-placeholder">
      <div class="market-icon">🏪</div>
      <h2>市场</h2>
      <p>即将推出...</p>
    </div>
  </div>
</template>

<style scoped>
.market-view {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}
.market-placeholder {
  text-align: center;
}
.market-icon {
  font-size: 48px;
  margin-bottom: 16px;
}
.market-placeholder h2 {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
}
.market-placeholder p {
  color: #999;
  font-size: 16px;
}
</style>
