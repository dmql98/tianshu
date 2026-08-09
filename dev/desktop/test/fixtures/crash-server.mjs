// Fake server: sends ready, then crashes shortly after.
process.send({ type: 'ready', port: 41118 })
setTimeout(() => process.exit(1), 300)
