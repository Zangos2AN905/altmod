export default async function ({ addon }) {
    let chunkSize = addon.settings.get("quality");
    const updateChunkSize = () => {
        ReduxStore.dispatch({
            type: 'scratch-gui/addon-util/SET_SOUND_EDITOR_WAVEFORM_CHUNK_SIZE',
            chunkSize: chunkSize
        });
    };

    updateChunkSize();
    addon.self.addEventListener("disabled", () => {
        chunkSize = 1024;
        updateChunkSize();
    });
    addon.self.addEventListener("reenabled", () => {
        chunkSize = addon.settings.get("quality");
        updateChunkSize();
    });
}
