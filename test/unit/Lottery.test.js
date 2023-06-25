const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", async function () {
          let Lottery, VRFCoordinatorV2Mock, entranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              //   const { deployer } = await getNamedAccounts(await deployments.fixture(["all"]))
              Lottery = await ethers.getContract("Lottery", deployer)
              interval = await Lottery.getInterval()
              VRFCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              entranceFee = await Lottery.getEntranceFee()
              deployer = (await getNamedAccounts()).deployer
          })
          describe("constructor", async function () {
              it("Initializes the Lottery correctly", async function () {
                  //Ideally we make our tests have 1 assert per "it"
                  const lotteryState = await Lottery.getLotteryState()
                  assert.equal(lotteryState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterLottery", async function () {
              it("reverts when you don't pay enough", async function () {
                  await expect(Lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__NotEnoughEthEnttered"
                  )
              })

              it("records players when they enter", async function () {
                  await Lottery.enterLottery({ value: entranceFee })
                  const playerFromContract = await Lottery.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("emits event on enter", async function () {
                  await expect(Lottery.enterLottery({ value: entranceFee })).to.emit(
                      Lottery,
                      "LotteryEnter"
                  )
              })

              it("doesn't allow entrance when Lottery is calculating", async () => {
                  await Lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  // We pretend to be Chainlink Automation
                  await Lottery.performUpkeep([]) // changes the state to calculating for our comparison below
                  await expect(Lottery.enterLottery({ value: entranceFee })).to.be.revertedWith(
                      // is reverted as Lottery is calculating
                      "Lottery__LotteryNotOpen"
                  )
              })
          })
      })
