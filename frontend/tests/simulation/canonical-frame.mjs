import {PLAYER_STRIDE,ENEMY_STRIDE,PICKUP_STRIDE}from'../../src/game/index.ts';
export function canonicalFrame(packet){
 const s=packet.transients;if(!s)return packet;
 const players=Array.from(s.players.subarray(0,s.playerCount*PLAYER_STRIDE)),enemies=Array.from(s.enemies.subarray(0,s.enemyCount*ENEMY_STRIDE));
 for(let i=0;i<s.playerCount;i++){const k=i*PLAYER_STRIDE;players[k+6]=s.colors[players[k+6]];for(let j=players[k+8];j<6;j++)for(let c=0;c<3;c++)players[k+10+j*3+c]=0;}
 for(let i=0;i<s.enemyCount;i++)enemies[i*ENEMY_STRIDE+5]=s.colors[enemies[i*ENEMY_STRIDE+5]];
 return{frame:packet.frame,transients:{players,enemies,pickups:Array.from(s.pickups.subarray(0,s.pickupCount*PICKUP_STRIDE)),playerIds:s.playerIds,enemyIds:s.enemyIds,pickupIds:s.pickupIds}};
}
