// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockERC721 {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 tokenId) external {
        ownerOf[tokenId] = to;
        balanceOf[to]++;
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == from, "Not owner");
        ownerOf[tokenId] = to;
        balanceOf[from]--;
        balanceOf[to]++;
    }
}
