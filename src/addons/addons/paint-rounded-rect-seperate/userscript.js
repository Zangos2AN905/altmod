export default async function ({ addon }) {
    // Wait until the paint editor is loaded
    await addon.tab.traps.getPaper();
    
    const updateToolbar = (enabled) => {
        ReduxStore.dispatch({
            type: 'scratch-paint/addon-util/TOGGLE_ROUNDED_RECT_MODE',
            enabled: enabled
        });
    };

    updateToolbar(true);
    addon.self.addEventListener("disabled", () => {
        updateToolbar(false);
    });
    addon.self.addEventListener("reenabled", () => {
        updateToolbar(true);
    });
}
