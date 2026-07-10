/**
 * cinema 桶导出:页面集成只需 CinemaFilm(七幕影片,谷段与终幕作 children
 * 传入)、FinaleStage(终幕)与 InkThread(谷段页边墨线);
 * StaticFilm 供无动效场景单独复用。
 */
export { CinemaFilm } from "./cinema-film";
export { InkThread } from "./ink-thread";
export { FinaleStage } from "./scene-finale";
export { StaticFilm } from "./static-film";
