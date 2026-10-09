/* brew · boot.js — loads three.js, the pmndrs post-processing stack and N8AO,
   and exposes them globally so the rest of the game can stay as ordered scripts. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as PP from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

window.THREE = THREE;
window.TX = { RoundedBoxGeometry, RoomEnvironment, BufferGeometryUtils, PP, N8AOPostPass };
