// The parts of the engine that the resume point reads and writes. The map
// makes a resume point, then an event starts and saves the game. Then the
// map asks the test to stop the web content process.
class Scene_Base {
    start() {}
    update() {}
}
class Scene_Boot extends Scene_Base {
    start() {
        SceneManager.goto(Scene_Title);
    }
}
class Scene_Title extends Scene_Base {
    update() {
        DataManager.setupNewGame();
        SceneManager.goto(Scene_Map);
    }
}
class Scene_Map extends Scene_Base {
    frames = 0;
    update() {
        ++this.frames;
        if (this.frames === 3) {
            $gameMap.eventRunning = true;
            $gameVariables.value = 60;
            DataManager.saveGame(1);
        }
        if (this.frames === 5) console.log("stop the web content process");
    }
}
class Scene_MenuBase extends Scene_Base {}
class Scene_Gameover extends Scene_Base {}

const SceneManager = {
    _scene: null,
    _stack: [],
    _next: null,
    goto(scene) {
        this._next = scene;
    },
    isSceneChanging() {
        return this._next !== null;
    },
    update() {
        if (this._next) {
            this._scene = new this._next();
            this._next = null;
            this._scene.start();
        }
        this._scene.update();
        Graphics.frameCount++;
        requestAnimationFrame(() => this.update());
    },
};

const Graphics = { frameCount: 0 };
const AudioManager = { saveBgm: () => ({}), saveBgs: () => ({}) };
const JsonEx = { stringify: JSON.stringify, parse: JSON.parse };
const character = () => ({ endBalloon() {}, endAnimation() {} });
let $gameSystem, $gameParty, $gameMessage, $gameTemp, $gameMap, $gamePlayer, $gameVariables;

const DataManager = {
    _lastAccessedId: 1,
    createGameObjects() {
        $gameSystem = { onAfterLoad() {} };
        $gameParty = { inBattle: () => false };
        $gameMessage = { isBusy: () => false };
        $gameTemp = { isCommonEventReserved: () => false };
        $gameMap = {
            eventRunning: false,
            isEventRunning() {
                return this.eventRunning;
            },
            vehicles: () => [],
            events: () => [],
        };
        $gamePlayer = { ...character(), followers: () => ({ _data: [] }) };
        $gameVariables = { value: 0 };
    },
    setupNewGame() {
        this.createGameObjects();
        $gameVariables.value = 42;
    },
    saveGame: () => true,
    makeSaveContents: () => ({ variable: $gameVariables.value }),
    extractSaveContents(contents) {
        $gameVariables.value = contents.variable;
        console.log(`variable ${contents.variable}`);
    },
};

window.onload = () => {
    DataManager.createGameObjects();
    SceneManager.goto(Scene_Boot);
    SceneManager.update();
};
