export function createRandomStrategy() {
  return {
    chooseAction({ validActions }) {
      const index = Math.floor(Math.random() * validActions.length);
      return validActions[index];
    },
  };
}
