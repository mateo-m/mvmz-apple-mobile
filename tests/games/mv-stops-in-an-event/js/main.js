// An event runs on the map from its start, so the game makes no resume
// point. The map asks the test to stop the web content process on its
// third frame.
class Scene_Base {
    update() {}
}
class Scene_Title extends Scene_Base {
    update() {
        SceneManager._scene = new Scene_Map();
    }
}
class Scene_Map extends Scene_Base {
    frames = 0;
    update() {
        if (++this.frames === 3) console.log("stop the web content process");
    }
}
class Scene_MenuBase extends Scene_Base {}
class Scene_Gameover extends Scene_Base {}

const SceneManager = {
    _scene: new Scene_Title(),
    _stack: [],
    isSceneChanging: () => false,
    update() {
        this._scene.update();
        requestAnimationFrame(() => this.update());
    },
};
const $gameParty = { inBattle: () => false };
const $gameMessage = { isBusy: () => false };
const $gameMap = { isEventRunning: () => true };

window.onload = () => SceneManager.update();
