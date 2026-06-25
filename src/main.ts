import { Application } from 'pixi.js';
import { RectTopology } from './core/topology.ts';
import { GameState } from './core/gameState.ts';
import { BoardView } from './view/BoardView.ts';
import { CONFIG } from './data/config.ts';

// 入口：装配 Pixi + Core(GameState) + View(BoardView)，ticker 驱动主循环。

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ background: '#0d0b14', resizeTo: window, antialias: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const topo = new RectTopology(CONFIG.board.rows, CONFIG.board.cols);
  const seed = Math.floor(Math.random() * 0x7fffffff); // 每局不同，8 卦均可出
  const state = new GameState(topo, seed);
  const view = new BoardView(app, state, topo);
  app.stage.addChild(view.root);

  app.ticker.add((t) => view.update(t.deltaMS / 1000));
}

void main();
