/* brew · boot.js — loads three.js + the add-ons we use and exposes them globally,
   so the rest of the game can stay as plain ordered scripts. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

window.THREE = THREE;
window.TX = { RoundedBoxGeometry, RoomEnvironment, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, BufferGeometryUtils, N8AOPass, SMAAPass };
